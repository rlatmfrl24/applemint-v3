import { expect, test } from "@playwright/test";
import {
	clearCrawlRuns,
	clearThreadTables,
	completeCrawlRun,
	countThreads,
	resetCrawlPolicies,
	seedCrawlAlert,
	seedCrawlRun,
	seedThreads,
	setCrawlSchedulerEnabled,
} from "./support/database";

test.beforeEach(async () => {
	await clearThreadTables();
	await clearCrawlRuns();
	await resetCrawlPolicies();
});

test("설정 기본 경로를 수집 설정으로 이동하고 기능별 화면을 탐색한다", async ({ page }) => {
	await page.goto("/main/setting");
	await expect(page).toHaveURL(/\/main\/setting\/crawling$/u);
	await expect(page.getByRole("heading", { name: "수집 설정" })).toBeVisible();
	await expect(page.getByRole("link", { name: /수집 설정/u })).toHaveAttribute(
		"aria-current",
		"page"
	);
	await expect(page.getByRole("link", { name: "Setting", exact: true })).toHaveAttribute(
		"aria-current",
		"page"
	);

	await page.getByRole("link", { name: /수집 운영/u }).click();
	await expect(page).toHaveURL(/\/main\/setting\/operations$/u, { timeout: 15_000 });
	await expect(page.getByRole("heading", { name: "크롤링 운영 현황" })).toBeVisible();
	await page.getByRole("link", { name: /데이터 관리/u }).click();
	await expect(page).toHaveURL(/\/main\/setting\/data$/u, { timeout: 15_000 });
	await expect(page.getByRole("heading", { name: "데이터 관리" })).toBeVisible();
});

test("소스 권장 주기와 다음 예상 시각을 표시하고 변경을 저장한다", async ({ page }) => {
	await setCrawlSchedulerEnabled(true);
	await seedCrawlRun({
		source: "battlepage",
		status: "succeeded",
		startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
	});

	await page.goto("/main/setting/crawling");
	const card = page.getByTestId("crawl-policy-battlepage");
	await expect(card).toContainText("권장 4시간");
	await expect(card.getByTestId("next-scheduled-at")).toContainText("후");

	await card.getByRole("button", { name: "1시간" }).click();
	await expect(card.getByText("저장 후 바로 실행 대상이 됩니다.")).toBeVisible();
	await card.getByRole("button", { name: "변경 저장" }).click();
	await expect(page.getByText("Battlepage 수집 정책을 저장했습니다.")).toBeVisible();
	await page.reload();
	await expect(card.getByLabel("사용자 지정(분)")).toHaveValue("60");
	await expect(card.getByTestId("next-scheduled-at")).toContainText(/실행 대기 중|분 후/u);
});

test("예약을 중지해도 같은 소스를 수동 실행할 수 있다", async ({ page }) => {
	await page.route("**/api/crawl/manual", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				target: "arcalive",
				status: "succeeded",
				insertedCount: 2,
				skippedCount: 3,
				warningCount: 0,
				durationMs: 500,
			}),
		});
	});
	await page.goto("/main/setting/crawling");
	const card = page.getByTestId("crawl-policy-arcalive");
	await card.getByLabel("Arcalive 예약 수집").uncheck();
	await card.getByRole("button", { name: "변경 저장" }).click();
	await expect(card).toContainText("예약 중지");

	await card.getByRole("button", { name: "지금 수집" }).click();
	await expect(page.getByRole("heading", { name: "Arcalive 지금 수집" })).toBeVisible();
	await page.getByRole("button", { name: "수집 시작" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "Arcalive 수동 수집 완료" })
	).toContainText("2건 저장");
});

test("최근 실행·소스 추세와 부분 실패 상세를 운영 화면에 표시한다", async ({ page }) => {
	await seedCrawlRun({
		source: "arcalive",
		status: "partial",
		startedAt: "2026-07-21T03:00:00.000Z",
		warnings: [
			{
				url: "https://arca.live/page/1",
				code: "below-minimum-items",
				severity: "warning",
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
				ignoredCount: 0,
				duplicateCount: 0,
				minimumItems: 10,
				attempt: 2,
			},
		],
		parserValidCount: 8,
		parserMinimumCount: 10,
	});
	await seedCrawlAlert("arcalive");

	await page.goto("/main/setting/operations");
	await expect(page.getByTestId("crawl-source-arcalive")).toContainText("부분 성공");
	await expect(page.getByTestId("crawl-trend-arcalive")).toBeVisible();
	await expect(page.getByTestId("crawl-run")).toHaveCount(1);
	await expect(page.getByTestId("active-crawl-alerts")).toContainText("Arcalive 장애 감지");
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

	await page.goto("/main/setting/operations");
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

	await page.goto("/main/setting/operations");
	await expect(page.getByTestId("active-crawl-run")).toHaveCount(0);
	await expect(page.getByTestId("crawl-run").first()).toContainText("중단됨");
});

for (const scenario of [
	{ status: 409, message: "크롤링이 이미 실행 중입니다." },
	{ status: 504, message: "크롤링 요청 시간이 초과되었습니다." },
]) {
	test(`수동 크롤링 ${scenario.status} 오류를 요약해 표시한다`, async ({ page }) => {
		await page.route("**/api/crawl/manual", async (route) => {
			await route.fulfill({
				status: scenario.status,
				contentType: "application/json",
				body: JSON.stringify({ error: scenario.message }),
			});
		});

		await page.goto("/main/setting/crawling");
		const card = page.getByTestId("crawl-policy-arcalive");
		await card.getByRole("button", { name: "지금 수집" }).click();
		await page.getByRole("button", { name: "수집 시작" }).click();
		await expect(
			page.getByRole("alert").filter({ hasText: "Arcalive 수동 수집 실패" })
		).toContainText(`${scenario.message} (HTTP ${scenario.status})`);
	});
}

test("대상 개수를 확인한 뒤 신규 글을 일괄 이동한다", async ({ page }) => {
	await seedThreads("inbox", 3, { prefix: "bulk-move" });
	await page.goto("/main/setting/data");
	await expect(page.getByTestId("new-thread-total-count")).toHaveText("3");

	await page.getByRole("button", { name: "모두 휴지통으로 이동" }).click();
	await expect(page.getByRole("heading", { name: "신규 글 전체 이동" })).toBeVisible();
	await expect(
		page.getByText("신규 글 3개를 휴지통으로 이동합니다. 계속하시겠습니까?")
	).toBeVisible();
	await page.getByRole("button", { name: "취소" }).click();
	expect(await countThreads("inbox")).toBe(3);

	await page.getByRole("button", { name: "모두 휴지통으로 이동" }).click();
	await page.getByRole("button", { name: "이동 진행" }).click();
	await expect(page.getByRole("alert").filter({ hasText: "이동 완료" })).toContainText(
		"3개의 신규 글"
	);
	await expect(page.getByTestId("new-thread-total-count")).toHaveText("0");
	expect(await countThreads("inbox")).toBe(0);
	expect(await countThreads("trash")).toBe(3);
});

test("모바일에서도 설정 메뉴와 소스 카드가 키보드 탐색 순서에 유지된다", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/main/setting/crawling");
	await expect(page.getByRole("navigation", { name: "설정 메뉴" })).toBeVisible();
	await expect(page.getByTestId("crawl-policy-arcalive")).toBeVisible();
	await page.keyboard.press("Tab");
	await expect(page.locator(":focus")).toBeVisible();
});
