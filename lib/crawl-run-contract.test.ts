import { describe, expect, it } from "vitest";
import { isCrawlRunsDashboard, parseDashboardLimit } from "./crawl-run-contract";

describe("crawl run dashboard contract", () => {
	it("limit 기본값과 1~50 범위를 검증한다", () => {
		expect(parseDashboardLimit(null)).toBe(20);
		expect(parseDashboardLimit("1")).toBe(1);
		expect(parseDashboardLimit("50")).toBe(50);
		expect(parseDashboardLimit("0")).toBeNull();
		expect(parseDashboardLimit("51")).toBeNull();
		expect(parseDashboardLimit("1.5")).toBeNull();
		expect(parseDashboardLimit("abc")).toBeNull();
	});

	it("dashboard 최상위 배열 계약을 검증한다", () => {
		expect(
			isCrawlRunsDashboard({
				activeRun: null,
				sources: [],
				runs: [],
				alerts: [],
				alertSettings: {
					parserFailureStreak: 2,
					parserDropRatio: 0.5,
					parserDropStreak: 2,
					noSuccessSeconds: 172800,
					transportWindow: 3,
					transportErrorRatio: 0.5,
					transportMinFailures: 2,
					cooldownSeconds: 86400,
				},
			})
		).toBe(true);
		expect(isCrawlRunsDashboard({ sources: [], runs: [], alerts: [], alertSettings: {} })).toBe(
			false
		);
		expect(isCrawlRunsDashboard({ sources: null, runs: [] })).toBe(false);
		expect(isCrawlRunsDashboard(null)).toBe(false);
	});
});
