import { expect, test } from "@playwright/test";
import {
	clearCrawlRuns,
	completeCrawlRun,
	resetCrawlPolicies,
	seedCrawlRun,
	setCrawlSchedulerEnabled,
} from "./support/database";

test.beforeEach(async () => {
	await clearCrawlRuns();
	await resetCrawlPolicies();
});

test("수집 정책 저장과 실행 상태 polling을 하나의 운영 흐름으로 검증한다", async ({ page }) => {
	await setCrawlSchedulerEnabled(true);
	await seedCrawlRun({
		source: "battlepage",
		status: "succeeded",
		startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
	});

	await page.goto("/main/setting/crawling");
	const policyCard = page.getByTestId("crawl-policy-battlepage");
	await policyCard.getByLabel("Battlepage 최소 수집 간격").selectOption("3600");
	await policyCard.getByRole("button", { name: "변경 저장" }).click();
	await expect(page.getByText("Battlepage 수집 정책을 저장했습니다.")).toBeVisible();
	await page.reload();
	await expect(policyCard.getByLabel("Battlepage 최소 수집 간격")).toHaveValue("3600");

	const runId = await seedCrawlRun({
		source: "battlepage",
		status: "running",
		startedAt: new Date().toISOString(),
	});
	await page.getByRole("link", { name: /수집 운영/u }).click();
	await expect(page.getByTestId("active-crawl-run")).toContainText("Battlepage 크롤링 실행 중");

	await completeCrawlRun(runId);
	await expect(page.getByTestId("active-crawl-run")).not.toBeVisible({ timeout: 10_000 });
	await expect(page.getByTestId("crawl-run").first()).toContainText("성공");
});
