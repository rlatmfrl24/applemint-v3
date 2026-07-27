import { describe, expect, it } from "vitest";
import {
	calculateParserTrend,
	chunkUrlsForHistoryQuery,
	constantTimeEquals,
	countCrawlFailureKinds,
	countCrawlWarnings,
	dedupeByUrl,
	defineType,
	getCompletedRunStatus,
	hasMinimumInternalSecretLength,
	isCrawlTarget,
	normalizeCrawlApiBaseUrl,
} from "./helpers";

describe("crawl-source helpers", () => {
	it("정확한 provider hostname을 keyword보다 먼저 분류한다", () => {
		const filters = [{ value: "youtube", method: "blocked" }];

		expect(defineType("https://www.youtube.com/watch?v=abcdefghijk", filters)).toBe("youtube");
		expect(defineType("https://imgur.com/a/Album12", filters)).toBe("imgur");
		expect(defineType("https://youtube.com.evil.example/post", filters)).toBe("blocked");
		expect(defineType("https://example.com/?next=youtube", filters)).toBe("blocked");
	});

	it("URL dedupe와 history query chunk 제한을 유지한다", () => {
		expect(
			dedupeByUrl([
				{ url: "a", value: 1 },
				{ url: "a", value: 2 },
				{ url: "b", value: 3 },
			])
		).toEqual([
			{ url: "a", value: 1 },
			{ url: "b", value: 3 },
		]);
		expect(chunkUrlsForHistoryQuery(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
	});

	it("info warning은 성공 상태와 warning count에 포함하지 않는다", () => {
		const infoWarnings = [{ code: "discarded-items", severity: "info" }];
		const actionableWarnings = [{ code: "below-minimum-items", severity: "warning" }];

		expect(getCompletedRunStatus([], infoWarnings)).toBe("succeeded");
		expect(countCrawlWarnings([], infoWarnings)).toBe(0);
		expect(getCompletedRunStatus([], actionableWarnings)).toBe("partial");
		expect(countCrawlWarnings([], actionableWarnings)).toBe(1);
	});

	it("failure 종류와 parser trend를 안전한 정수로 계산한다", () => {
		expect(
			countCrawlFailureKinds([
				{ kind: "network" },
				{ kind: "parser" },
				{ kind: "network", timeout: true },
			])
		).toEqual({
			networkFailureCount: 1,
			parserFailureCount: 1,
			timeoutFailureCount: 1,
		});
		expect(
			calculateParserTrend(
				[
					{ status: "ok", validCount: 5, minimumItems: 3 },
					{ status: "empty", validCount: 0, minimumItems: 3 },
				],
				0
			)
		).toEqual({ parserValidCount: 5, parserMinimumCount: 3 });
	});

	it("target, internal secret, base URL을 fail closed로 검증한다", async () => {
		expect(isCrawlTarget("arcalive")).toBe(true);
		expect(isCrawlTarget("unknown")).toBe(false);
		expect(hasMinimumInternalSecretLength("a".repeat(31))).toBe(false);
		expect(hasMinimumInternalSecretLength("가".repeat(11))).toBe(true);
		await expect(constantTimeEquals("secret", "secret")).resolves.toBe(true);
		await expect(constantTimeEquals(null, "secret")).resolves.toBe(false);
		expect(normalizeCrawlApiBaseUrl("https://example.com/path/?token=secret#hash")).toBe(
			"https://example.com/path"
		);
		expect(normalizeCrawlApiBaseUrl("ftp://example.com")).toBe("");
		expect(normalizeCrawlApiBaseUrl(undefined)).toBe("");
	});
});
