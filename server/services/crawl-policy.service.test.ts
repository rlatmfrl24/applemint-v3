import { describe, expect, it, vi } from "vitest";
import type { CrawlPolicyRepository } from "@/server/repositories/crawl-policy.repository";
import { crawlPolicySettings, NOW } from "@/test/support/communication";
import { CrawlPolicyService } from "./crawl-policy.service";

describe("CrawlPolicyService", () => {
	it("정책 조회를 repository에 위임한다", async () => {
		const repository = { get: vi.fn().mockResolvedValue(crawlPolicySettings) };
		const service = new CrawlPolicyService(repository as unknown as CrawlPolicyRepository);
		await expect(service.get()).resolves.toEqual(crawlPolicySettings);
	});

	it("성공한 compare-and-swap 결과에서 settings만 반환한다", async () => {
		const repository = {
			update: vi
				.fn()
				.mockResolvedValue({ updated: true, reason: null, settings: crawlPolicySettings }),
		};
		const service = new CrawlPolicyService(repository as unknown as CrawlPolicyRepository);
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
			update: vi
				.fn()
				.mockResolvedValue({ updated: false, reason: "conflict", settings: crawlPolicySettings }),
		};
		const service = new CrawlPolicyService(repository as unknown as CrawlPolicyRepository);
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
});
