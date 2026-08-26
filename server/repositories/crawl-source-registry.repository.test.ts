import { describe, expect, it, vi } from "vitest";
import { RequestMetrics } from "@/server/observability/request-metrics";
import { crawlSourceRegistry } from "@/test/support/communication";
import type { AppSupabaseClient } from "@/types/supabase";
import { CrawlSourceRegistryRepository } from "./crawl-source-registry.repository";

describe("CrawlSourceRegistryRepository", () => {
	it("registry RPC 응답을 검증하고 repository metrics를 기록한다", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: crawlSourceRegistry, error: null });
		const metrics = new RequestMetrics();
		const repository = new CrawlSourceRegistryRepository(
			{ rpc } as unknown as AppSupabaseClient,
			metrics
		);

		await expect(repository.get()).resolves.toEqual(crawlSourceRegistry);
		expect(rpc).toHaveBeenCalledWith("get_crawl_source_registry");
		expect(metrics.snapshot()).toMatchObject({
			repositoryCallCount: 1,
			downstreamCallCount: 1,
			repositoryCalls: [{ operation: "crawlSourceRegistry.get", callCount: 1 }],
		});
	});

	it("DB 오류와 손상된 registry 응답을 fail closed 한다", async () => {
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({
				data: null,
				error: { code: "XX000", message: "unavailable", details: "", hint: "" },
			})
			.mockResolvedValueOnce({
				data: {
					...crawlSourceRegistry,
					sources: [...crawlSourceRegistry.sources, { ...crawlSourceRegistry.sources[0] }],
				},
				error: null,
			});
		const repository = new CrawlSourceRegistryRepository({
			rpc,
		} as unknown as AppSupabaseClient);

		await expect(repository.get()).rejects.toMatchObject({ code: "UnexpectedFailure" });
		await expect(repository.get()).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});
});
