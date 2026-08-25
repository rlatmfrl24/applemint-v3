import { describe, expect, it } from "vitest";
import { crawlAlertsDashboard, crawlRunsBaseDashboard } from "@/test/support/communication";
import { crawlRunsDashboardSchema, crawlRunsInputSchema } from "./crawl-run.schema";

const dashboard = {
	...crawlRunsBaseDashboard,
	...crawlAlertsDashboard,
};

describe("crawl run Zod contract", () => {
	it("빈 운영 dashboard의 전체 shape를 검증한다", () => {
		expect(crawlRunsDashboardSchema.parse(dashboard)).toEqual(dashboard);
	});

	it("runtime/alert 중첩 필드가 손상된 응답을 거부한다", () => {
		expect(
			crawlRunsDashboardSchema.safeParse({
				...dashboard,
				runtimeSettings: { ...dashboard.runtimeSettings, maxConcurrency: "2" },
			}).success
		).toBe(false);
		expect(
			crawlRunsDashboardSchema.safeParse({
				...dashboard,
				alertSettings: { ...dashboard.alertSettings, transportWindow: null },
			}).success
		).toBe(false);
	});

	it("dashboard limit 기본값과 1~50 범위를 검증한다", () => {
		expect(crawlRunsInputSchema.parse({})).toEqual({ limit: 20, trendLimit: 20 });
		expect(crawlRunsInputSchema.safeParse({ limit: 1, trendLimit: 50 }).success).toBe(true);
		expect(crawlRunsInputSchema.safeParse({ limit: 0, trendLimit: 20 }).success).toBe(false);
		expect(crawlRunsInputSchema.safeParse({ limit: 20, trendLimit: 51 }).success).toBe(false);
		expect(crawlRunsInputSchema.safeParse({ limit: 1.5, trendLimit: 20 }).success).toBe(false);
	});

	it("실행 상세에서 upstream-challenge kind를 허용하고 알 수 없는 kind는 거부한다", () => {
		const run = {
			id: "1",
			source: "arcalive",
			status: "failed",
			trigger: "scheduled",
			startedAt: "2026-08-25T00:00:00.000Z",
			finishedAt: "2026-08-25T00:00:01.000Z",
			lastHeartbeatAt: null,
			durationMs: 1000,
			retryCount: 0,
			recoveredCount: 0,
			attemptedCount: 1,
			succeededCount: 0,
			extractedCount: 0,
			insertedCount: 0,
			skippedCount: 0,
			warningCount: 0,
			failureCount: 1,
			networkFailureCount: 1,
			parserFailureCount: 0,
			timeoutFailureCount: 0,
			parserValidCount: 0,
			parserMinimumCount: 0,
			warnings: [],
			failures: [
				{
					url: "https://arca.live/api/app/list/channel/iloveanimal",
					message: "HTTP 403 Cloudflare Challenge",
					kind: "upstream-challenge",
					attempt: 1,
				},
			],
			parserObservations: [],
			errorStage: "source",
			errorMessage: "모든 소스 요청이 실패했습니다.",
		};

		expect(crawlRunsDashboardSchema.safeParse({ ...dashboard, runs: [run] }).success).toBe(true);
		expect(
			crawlRunsDashboardSchema.safeParse({
				...dashboard,
				runs: [{ ...run, failures: [{ ...run.failures[0], kind: "challenge" }] }],
			}).success
		).toBe(false);
	});
});
