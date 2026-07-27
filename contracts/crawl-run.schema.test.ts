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
});
