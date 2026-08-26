import { describe, expect, it, vi } from "vitest";
import type { CrawlRunStore } from "@/server/ports/crawl-run.store";
import { crawlAlertsDashboard, crawlRunsBaseDashboard, NOW } from "@/test/support/communication";
import { CrawlRunService } from "./crawl-run.service";

describe("CrawlRunService", () => {
	it("실행 이력과 장애 알림을 병렬 조합한다", async () => {
		const repository = {
			getRuns: vi.fn().mockResolvedValue(crawlRunsBaseDashboard),
			getAlerts: vi.fn().mockResolvedValue(crawlAlertsDashboard),
		};
		const service = new CrawlRunService(repository as unknown as CrawlRunStore);
		await expect(service.getDashboard({ limit: 20, trendLimit: 20 })).resolves.toEqual({
			...crawlRunsBaseDashboard,
			...crawlAlertsDashboard,
		});
	});

	it("소스별 active alert 건수를 계산한다", async () => {
		const source = {
			source: "arcalive" as const,
			scheduleEnabled: true,
			cooldownSeconds: 3600,
			runBudgetSeconds: 45,
			lastFinishedAt: null,
			nextEligibleAt: null,
			lastSuccessAt: null,
			lastFailureAt: null,
			latest: null,
			trend: [],
		};
		const repository = {
			getRuns: vi.fn().mockResolvedValue({ ...crawlRunsBaseDashboard, sources: [source] }),
			getAlerts: vi.fn().mockResolvedValue({
				...crawlAlertsDashboard,
				alerts: [
					{
						id: "1",
						source: "arcalive",
						activeSignals: ["parser-failure"],
						openedAt: NOW,
						lastObservedAt: NOW,
						snapshot: {
							latestRunId: null,
							parserFailureTriggered: true,
							parserValidRatio: null,
							lastSuccessAt: null,
							hoursSinceSuccess: null,
							transportWindow: 3,
							transportAttemptedCount: 0,
							transportFailureCount: 0,
							transportFailureRatio: 0,
						},
					},
				],
			}),
		};
		const service = new CrawlRunService(repository as unknown as CrawlRunStore);
		const result = await service.getDashboard({ limit: 20, trendLimit: 20 });
		expect(result.sources[0].activeAlertCount).toBe(1);
	});
});
