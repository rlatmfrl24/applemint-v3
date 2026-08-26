import { describe, expect, it, vi } from "vitest";
import type { CrawlSourceRegistry } from "@/contracts/crawl-source-registry.schema";
import type { CrawlSourceRegistryStore } from "@/server/ports/crawl-source-registry.store";
import { crawlSourceRegistry, installedCrawlSources } from "@/test/support/communication";
import {
	attachInstalledCrawlSourceLabels,
	CrawlSourceRegistryService,
} from "./crawl-source-registry.service";

function createService(registry: CrawlSourceRegistry = crawlSourceRegistry) {
	return new CrawlSourceRegistryService({
		get: vi.fn().mockResolvedValue(registry),
	} as unknown as CrawlSourceRegistryStore);
}

describe("CrawlSourceRegistryService", () => {
	it("활성 registry label을 설치된 adapter 순서로 반환하고 retired source는 보존만 한다", async () => {
		await expect(createService().getInstalledSources()).resolves.toEqual(installedCrawlSources);
	});

	it.each([
		["누락", crawlSourceRegistry.sources.filter((entry) => entry.source !== "issuelink")],
		[
			"추가",
			[
				...crawlSourceRegistry.sources,
				{
					source: "future-source",
					label: "Future Source",
					active: true,
					retiredAt: null,
					updatedAt: crawlSourceRegistry.sources[0].updatedAt,
				},
			],
		],
	])("활성 registry source가 adapter와 %s되면 실패한다", async (_name, sources) => {
		await expect(createService({ sources }).getInstalledSources()).rejects.toMatchObject({
			code: "UnexpectedFailure",
		});
	});

	it("정책·dashboard 행의 source 집합을 검증한 뒤 registry label을 결합한다", () => {
		const rows = installedCrawlSources.map(({ source }) => ({ source, enabled: true }));
		expect(attachInstalledCrawlSourceLabels(rows, installedCrawlSources, "test")).toEqual(
			installedCrawlSources.map(({ source, label }) => ({ source, label, enabled: true }))
		);
		expect(() =>
			attachInstalledCrawlSourceLabels(rows.slice(1), installedCrawlSources, "test")
		).toThrow("source 목록이 활성 registry와 일치하지 않습니다");
	});
});
