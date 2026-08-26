import { describe, expect, it, vi } from "vitest";
import type { CrawlPolicyStore } from "@/server/ports/crawl-policy.store";
import {
	crawlPolicySettings,
	crawlPolicySettingsRaw,
	installedCrawlSources,
	NOW,
} from "@/test/support/communication";
import { CrawlPolicyService } from "./crawl-policy.service";
import type { CrawlSourceRegistryService } from "./crawl-source-registry.service";

const registry = {
	getInstalledSources: vi.fn().mockResolvedValue(installedCrawlSources),
} as unknown as CrawlSourceRegistryService;

describe("CrawlPolicyService", () => {
	it("정책 조회를 repository에 위임한다", async () => {
		const repository = { get: vi.fn().mockResolvedValue(crawlPolicySettingsRaw) };
		const service = new CrawlPolicyService(repository as unknown as CrawlPolicyStore, registry);
		await expect(service.get()).resolves.toEqual(crawlPolicySettings);
	});

	it("성공한 compare-and-swap 결과에서 settings만 반환한다", async () => {
		const repository = {
			update: vi
				.fn()
				.mockResolvedValue({ updated: true, reason: null, settings: crawlPolicySettingsRaw }),
		};
		const service = new CrawlPolicyService(repository as unknown as CrawlPolicyStore, registry);
		await expect(
			service.update({
				source: "arcalive",
				scheduleEnabled: false,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
			})
		).resolves.toEqual(crawlPolicySettings);
	});

	it("동시 수정 충돌에 최신 settings를 복구 데이터로 포함한다", async () => {
		const repository = {
			update: vi.fn().mockResolvedValue({
				updated: false,
				reason: "conflict",
				settings: crawlPolicySettingsRaw,
			}),
		};
		const service = new CrawlPolicyService(repository as unknown as CrawlPolicyStore, registry);
		const error = await service
			.update({
				source: "arcalive",
				scheduleEnabled: false,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
			})
			.catch((caught) => caught);
		expect(error).toMatchObject({
			code: "StateConflict",
			data: { latestSettings: crawlPolicySettings },
		});
	});

	it("registry parity를 확인하지 못하면 정책을 변경하지 않는다", async () => {
		const repository = { update: vi.fn() };
		const unavailableRegistry = {
			getInstalledSources: vi.fn().mockRejectedValue(new Error("registry unavailable")),
		} as unknown as CrawlSourceRegistryService;
		const service = new CrawlPolicyService(
			repository as unknown as CrawlPolicyStore,
			unavailableRegistry
		);

		await expect(
			service.update({
				source: "arcalive",
				scheduleEnabled: false,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
			})
		).rejects.toThrow("registry unavailable");
		expect(repository.update).not.toHaveBeenCalled();
	});
});
