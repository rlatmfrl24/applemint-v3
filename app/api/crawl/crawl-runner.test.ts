import { describe, expect, it, vi } from "vitest";
import type { CrawlAdapterOptions, CrawlSourceResult } from "./contracts";
import { runCrawlerWithRetry } from "./crawl-runner";

function result(overrides: Partial<CrawlSourceResult> = {}): CrawlSourceResult {
	return {
		items: [],
		attemptedUrls: [],
		attempted: 0,
		succeeded: 0,
		failures: [],
		warnings: [],
		parserObservations: [],
		...overrides,
	};
}

describe("runCrawlerWithRetry", () => {
	it("실패 URL만 재시도하고 성공 데이터와 최종 관측치를 합친다", async () => {
		const crawler = vi
			.fn<(options?: CrawlAdapterOptions) => Promise<CrawlSourceResult>>()
			.mockResolvedValueOnce(
				result({
					items: [
						{ url: "https://example.com/a", title: "a", description: null, host: "example.com" },
					],
					attemptedUrls: ["page-a", "page-b"],
					attempted: 2,
					succeeded: 1,
					failures: [{ url: "page-b", message: "parser", kind: "parser" }],
					warnings: [
						{
							url: "page-b",
							code: "discarded-items",
							severity: "info",
							message: "discarded",
							count: 1,
						},
					],
					parserObservations: [
						{
							url: "page-a",
							status: "ok",
							candidateCount: 1,
							validCount: 1,
							discardedCount: 0,
							ignoredCount: 0,
							duplicateCount: 0,
							minimumItems: 1,
						},
					],
				})
			)
			.mockResolvedValueOnce(
				result({
					items: [
						{ url: "https://example.com/b", title: "b", description: null, host: "example.com" },
					],
					attemptedUrls: ["page-b"],
					attempted: 1,
					succeeded: 1,
					parserObservations: [
						{
							url: "page-b",
							status: "ok",
							candidateCount: 1,
							validCount: 1,
							discardedCount: 0,
							ignoredCount: 0,
							duplicateCount: 0,
							minimumItems: 1,
						},
					],
				})
			);

		const execution = await runCrawlerWithRetry("battlepage", crawler, async () => {});

		expect(crawler).toHaveBeenNthCalledWith(2, { urls: ["page-b"] });
		expect(execution).toMatchObject({
			attempted: 3,
			succeeded: 2,
			retryCount: 1,
			recoveredCount: 1,
			failures: [],
			warnings: [],
			parserValidCount: 2,
		});
		expect(execution.items.map((item) => item.url)).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
	});

	it("재시도 후에도 실패한 URL은 마지막 실패만 남긴다", async () => {
		const failure = { url: "page-a", message: "timeout", kind: "network" as const, timeout: true };
		const crawler = vi
			.fn<(options?: CrawlAdapterOptions) => Promise<CrawlSourceResult>>()
			.mockResolvedValue(result({ attemptedUrls: ["page-a"], attempted: 1, failures: [failure] }));

		const execution = await runCrawlerWithRetry("arcalive", crawler, async () => {});

		expect(execution).toMatchObject({ attempted: 2, retryCount: 1, recoveredCount: 0 });
		expect(execution.failures).toEqual([expect.objectContaining({ attempt: 2, timeout: true })]);
	});

	it("작업 단위를 만들기 전 발생한 예외는 소스 전체를 한 번 재시도한다", async () => {
		const crawler = vi
			.fn<(options?: CrawlAdapterOptions) => Promise<CrawlSourceResult>>()
			.mockRejectedValueOnce(new Error("adapter failed"))
			.mockResolvedValueOnce(result({ attemptedUrls: ["page-a"], attempted: 1, succeeded: 1 }));

		const execution = await runCrawlerWithRetry("insagirl", crawler, async () => {});

		expect(crawler).toHaveBeenCalledTimes(2);
		expect(execution).toMatchObject({ attempted: 1, succeeded: 1, retryCount: 1 });
	});

	it("실행 예산이 재시도 전에 끝나면 이미 성공한 결과를 부분 결과로 보존한다", async () => {
		const controller = new AbortController();
		const crawler = vi.fn().mockResolvedValue(
			result({
				items: [
					{ url: "https://example.com/a", title: "a", description: null, host: "example.com" },
				],
				attemptedUrls: ["page-a", "page-b"],
				attempted: 2,
				succeeded: 1,
				failures: [{ url: "page-b", message: "timeout", kind: "network", timeout: true }],
			})
		);

		const execution = await runCrawlerWithRetry(
			"arcalive",
			crawler,
			async () => controller.abort(new DOMException("budget", "TimeoutError")),
			{ signal: controller.signal }
		);

		expect(crawler).toHaveBeenCalledTimes(1);
		expect(execution).toMatchObject({ attempted: 2, succeeded: 1, retryCount: 0 });
		expect(execution.items).toHaveLength(1);
	});
});
