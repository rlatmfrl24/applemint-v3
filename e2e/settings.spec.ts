import { expect, test } from "@playwright/test";
import {
	clearCrawlRuns,
	clearThreadTables,
	completeCrawlRun,
	countThreads,
	seedCrawlAlert,
	seedCrawlRun,
	seedThreads,
} from "./support/database";

test.beforeEach(async () => {
	await clearThreadTables();
	await clearCrawlRuns();
});

test("최근 실행·소스 추세와 부분 실패 상세를 표시한다", async ({ page }) => {
	await seedCrawlRun({
		source: "arcalive",
		status: "partial",
		startedAt: "2026-07-21T03:00:00.000Z",
		warnings: [
			{
				url: "https://arca.live/page/1",
				code: "below-minimum-items",
				message: "최소 건수 미달",
				count: 8,
				attempt: 2,
			},
		],
		failures: [
			{
				url: "https://arca.live/page/1",
				kind: "network",
				timeout: true,
				message: "timed out",
				attempt: 1,
			},
		],
		parserObservations: [
			{
				url: "https://arca.live/page/1",
				status: "ok",
				candidateCount: 8,
				validCount: 8,
				discardedCount: 0,
				minimumItems: 10,
				attempt: 2,
			},
		],
		parserValidCount: 8,
		parserMinimumCount: 10,
	});
	await seedCrawlAlert("arcalive");

	await page.goto("/main/setting");
	await expect(page.getByRole("heading", { name: "크롤링 운영 현황" })).toBeVisible();
	await expect(page.getByTestId("crawl-source-arcalive")).toContainText("부분 성공");
	await expect(page.getByTestId("crawl-trend-arcalive")).toBeVisible();
	await expect(page.getByTestId("crawl-run")).toHaveCount(1);
	await expect(page.getByTestId("active-crawl-alerts")).toContainText("Arcalive 장애 감지");
	await expect(page.getByTestId("active-crawl-alerts")).toContainText("GitHub Issue #123");
	await expect(page.getByTestId("crawl-alert-settings")).toContainText("성공 실행 없음 48시간");
	await page.getByText("경고·실패 상세보기").click();
	await expect(page.getByText(/timeout · timed out/u)).toBeVisible();
	await expect(page.getByText(/below-minimum-items · 최소 건수 미달/u)).toBeVisible();
});

test("실행 중 상태를 polling으로 완료 상태로 갱신한다", async ({ page }) => {
	const runId = await seedCrawlRun({
		source: "battlepage",
		status: "running",
		startedAt: new Date().toISOString(),
	});

	await page.goto("/main/setting");
	await expect(page.getByTestId("active-crawl-run")).toContainText("Battlepage 크롤링 실행 중");
	await completeCrawlRun(runId);
	await expect(page.getByTestId("active-crawl-run")).not.toBeVisible({ timeout: 10_000 });
	await expect(page.getByTestId("crawl-run").first()).toContainText("성공");
});

test("TTL을 넘긴 미완료 실행을 중단됨으로 식별한다", async ({ page }) => {
	await seedCrawlRun({
		source: "insagirl",
		status: "running",
		startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
		staleAfter: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
	});

	await page.goto("/main/setting");
	await expect(page.getByTestId("active-crawl-run")).toHaveCount(0);
	await expect(page.getByTestId("crawl-run").first()).toContainText("중단됨");
});

test("수동 크롤링 loading과 성공 결과를 표시한다", async ({ page }) => {
	let historyRequestCount = 0;
	page.on("request", (request) => {
		if (request.url().includes("/api/crawl/runs")) historyRequestCount += 1;
	});
	await page.route("**/api/crawl/manual", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 350));
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				target: "arcalive",
				insertedCount: 22,
				skippedCount: 113,
				warningCount: 0,
				durationMs: 6999,
			}),
		});
	});

	await page.goto("/main/setting");
	await page.getByRole("button", { name: "Crawl Arcalive" }).click();
	await expect(page.getByRole("heading", { name: "Crawl Arcalive" })).toBeVisible();
	await page.getByRole("button", { name: "Crawl", exact: true }).click();

	const result = page.getByLabel("크롤링 결과");
	await expect(result).toHaveValue("Loading...");
	await expect(result).toHaveValue(/"httpStatus": 200/u);
	await expect(result).toHaveValue(/"insertedCount": 22/u);
	await expect(result).toHaveValue(/"skippedCount": 113/u);
	await expect.poll(() => historyRequestCount).toBeGreaterThanOrEqual(3);
});

for (const scenario of [
	{ status: 409, message: "크롤링이 이미 실행 중입니다." },
	{ status: 504, message: "크롤링 요청 시간이 초과되었습니다." },
]) {
	test(`수동 크롤링 ${scenario.status} 오류를 구조화해 표시한다`, async ({ page }) => {
		await page.route("**/api/crawl/manual", async (route) => {
			await route.fulfill({
				status: scenario.status,
				contentType: "application/json",
				body: JSON.stringify({ error: scenario.message }),
			});
		});

		await page.goto("/main/setting");
		await page.getByRole("button", { name: "Crawl Arcalive" }).click();
		await page.getByRole("button", { name: "Crawl", exact: true }).click();

		const result = page.getByLabel("크롤링 결과");
		await expect(result).toHaveValue(new RegExp(`"httpStatus": ${scenario.status}`, "u"));
		await expect(result).toHaveValue(new RegExp(scenario.message, "u"));
	});
}

test("일괄 이동을 취소한 뒤 진행 상태와 완료 결과를 표시한다", async ({ page }) => {
	await seedThreads("new-threads", 3, { prefix: "bulk-move" });
	await page.goto("/main/setting");

	await page.getByRole("button", { name: "모두 휴지통으로 이동" }).click();
	await expect(page.getByRole("heading", { name: "모든 신규 스레드 이동" })).toBeVisible();
	await expect(
		page.getByText("모든 신규 스레드를 휴지통으로 이동합니다. 계속하시겠습니까?")
	).toBeVisible();
	await page.getByRole("button", { name: "취소" }).click();
	expect(await countThreads("new-threads")).toBe(3);
	expect(await countThreads("trash")).toBe(0);

	await page.route("**/rest/v1/rpc/bulk_move_new_threads_to_trash", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 350));
		await route.continue();
	});
	await page.getByRole("button", { name: "모두 휴지통으로 이동" }).click();
	await page.getByRole("button", { name: "이동 진행" }).click();

	const status = page.getByLabel("일괄 이동 결과");
	await expect(status).toHaveValue("이동을 진행 중입니다...");
	await expect(status).toHaveValue("총 3개의 스레드를 휴지통으로 이동했습니다.");
	expect(await countThreads("new-threads")).toBe(0);
	expect(await countThreads("trash")).toBe(3);

	await page.getByRole("link", { name: "Main", exact: true }).click();
	await expect(page.getByText("No Data", { exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Trash", exact: true }).click();
	await expect(page.getByTestId("thread-card")).toHaveCount(3);
});
