import { describe, expect, it } from "vitest";
import {
	crawlCommandRequestSchema,
	crawlCommandSuccessSchema,
	scheduledCrawlResponseSchema,
} from "./crawl-command.schema";

describe("crawl command contracts", () => {
	it("활성 source만 허용하고 알 수 없는 필드를 거부한다", () => {
		expect(crawlCommandRequestSchema.safeParse({ target: "arcalive" }).success).toBe(true);
		expect(crawlCommandRequestSchema.safeParse({ target: "issuelink" }).success).toBe(true);
		expect(crawlCommandRequestSchema.safeParse({ target: "dogdrip" }).success).toBe(true);
		expect(
			crawlCommandRequestSchema.safeParse({ target: "arcalive", unexpected: true }).success
		).toBe(false);
	});

	it("수동 크롤링 성공 응답의 필수 필드와 정수 범위를 검증한다", () => {
		const response = {
			runId: "42",
			status: "succeeded",
			target: "arcalive",
			insertedCount: 3,
			skippedCount: 1,
			warningCount: 0,
			durationMs: 100,
		};
		expect(crawlCommandSuccessSchema.safeParse(response).success).toBe(true);
		expect(crawlCommandSuccessSchema.safeParse({ ...response, durationMs: -1 }).success).toBe(
			false
		);
	});

	it("PostgreSQL timestamptz offset이 포함된 cooldown 응답을 허용한다", () => {
		const response = {
			status: "skipped",
			target: "arcalive",
			reason: "cooldown",
			nextEligibleAt: "2026-07-22T06:00:00+00:00",
			activeRunId: null,
		};

		expect(scheduledCrawlResponseSchema.safeParse(response).success).toBe(true);
		expect(
			scheduledCrawlResponseSchema.safeParse({
				...response,
				nextEligibleAt: "2026-07-22 06:00:00",
			}).success
		).toBe(false);
	});
});
