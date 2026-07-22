import { describe, expect, it } from "vitest";
import type { CrawlExecutionResult } from "./contracts";
import {
	chunkUrlsForHistoryQuery,
	countActionableCrawlWarnings,
	createRunResult,
	dedupeByUrl,
	defineType,
	getCompletedRunStatus,
} from "./pipeline-helpers";

function createExecutionResult(
	overrides: Partial<CrawlExecutionResult> = {}
): CrawlExecutionResult {
	return {
		items: [],
		attempted: 1,
		succeeded: 1,
		failures: [],
		warnings: [],
		parserObservations: [],
		retryCount: 0,
		recoveredCount: 0,
		parserValidCount: 0,
		parserMinimumCount: 0,
		...overrides,
	};
}

describe("crawl pipeline helpers", () => {
	it("URL 중복 제거는 첫 번째 항목을 유지한다", () => {
		expect(
			dedupeByUrl([
				{ url: "https://example.com/1", title: "first" },
				{ url: "https://example.com/1", title: "duplicate" },
			])
		).toEqual([{ url: "https://example.com/1", title: "first" }]);
	});

	it("필터 키워드 method로 타입을 분류하고 기본값은 normal이다", () => {
		const filters = [{ value: "example.com", method: "source" }];
		expect(defineType("https://example.com/post", filters)).toBe("source");
		expect(defineType("https://other.test/post", filters)).toBe("normal");
	});

	it("history 조회 URL을 항목 수와 인코딩 길이 기준으로 분할한다", () => {
		const urls = Array.from(
			{ length: 306 },
			(_, index) => `https://example.com/${index}?title=${"가".repeat(20)}`
		);
		const chunks = chunkUrlsForHistoryQuery(urls);

		expect(chunks.flat()).toEqual(urls);
		expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
		expect(
			chunks.every(
				(chunk) =>
					chunk.length === 1 ||
					chunk.reduce((total, url) => total + encodeURIComponent(url).length + 3, 0) <= 6000
			)
		).toBe(true);
	});

	it("정보성 제외는 성공으로, 조치 가능한 경고는 partial로 기록한다", () => {
		expect(getCompletedRunStatus(createExecutionResult())).toBe("succeeded");
		expect(
			getCompletedRunStatus(
				createExecutionResult({
					warnings: [
						{
							url: "https://example.com",
							code: "empty-list",
							severity: "info",
							message: "empty",
							count: 0,
							attempt: 1,
						},
					],
				})
			)
		).toBe("succeeded");
		expect(
			getCompletedRunStatus(
				createExecutionResult({
					warnings: [
						{
							url: "https://example.com",
							code: "below-minimum-items",
							severity: "warning",
							message: "below minimum",
							count: 1,
							attempt: 1,
						},
					],
				})
			)
		).toBe("partial");
		expect(
			countActionableCrawlWarnings([
				{ code: "discarded-items", severity: "info" },
				{ code: "below-minimum-items", severity: "warning" },
			])
		).toBe(1);
	});

	it("실행 이력 집계에서 timeout을 network와 중복 집계하지 않는다", () => {
		const result = createRunResult(
			"failed",
			createExecutionResult({
				failures: [
					{
						url: "https://example.com",
						message: "timeout",
						kind: "network",
						timeout: true,
						attempt: 1,
					},
				],
			}),
			0,
			0,
			"source",
			"failed"
		);

		expect(result).toMatchObject({
			failureCount: 1,
			networkFailureCount: 0,
			timeoutFailureCount: 1,
			errorStage: "source",
		});
	});
});
