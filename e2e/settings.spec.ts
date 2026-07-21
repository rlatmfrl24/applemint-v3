import { expect, test } from "@playwright/test";
import { clearThreadTables, countThreads, seedThreads } from "./support/database";

test.beforeEach(async () => {
	await clearThreadTables();
});

test("수동 크롤링 loading과 성공 결과를 표시한다", async ({ page }) => {
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
