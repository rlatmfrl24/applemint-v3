import { expect, test } from "@playwright/test";
import { clearThreadTables, type E2EThreadState, seedThreads } from "./support/database";

const listCases: Array<{ state: E2EThreadState; path: string }> = [
	{ state: "inbox", path: "/main" },
	{ state: "saved", path: "/main/quick" },
	{ state: "trash", path: "/main/trash" },
];

test.beforeEach(async () => {
	await clearThreadTables();
});

for (const { state, path } of listCases) {
	test(`${state} 목록을 복합 커서로 끝까지 불러온다`, async ({ page }) => {
		await seedThreads(state, 31, { prefix: `${state}-pagination` });
		const firstPageResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				url.pathname === "/api/threads" &&
				url.searchParams.get("state") === state &&
				!url.searchParams.has("cursor")
			);
		});

		await page.goto(path);
		const response = await firstPageResponse;
		expect(response.status()).toBe(200);
		const firstPage = (await response.json()) as {
			items: Array<{ url: string }>;
			nextCursor: string | null;
		};
		expect(firstPage.items).toHaveLength(24);
		expect(firstPage.nextCursor).toEqual(expect.any(String));

		await page.getByTestId(`${state}-load-more-sentinel`).scrollIntoViewIfNeeded();
		const cards = page.getByTestId("thread-card");
		await expect(cards).toHaveCount(31);

		const urls = await cards.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute("data-thread-url"))
		);
		expect(new Set(urls).size).toBe(31);
	});
}

test("Main 필터 변경 시 다른 목록 cache가 섞이지 않는다", async ({ page }) => {
	await seedThreads("inbox", 26, { prefix: "filter-arcalive", type: "arcalive" });
	await seedThreads("inbox", 5, { prefix: "filter-battlepage", type: "battlepage" });

	await page.goto("/main");
	const battlepageFilter = page.getByRole("radio", { name: "battlepage" });
	await expect(battlepageFilter).toBeVisible();

	const filteredRequest = page.waitForRequest((request) => {
		const url = new URL(request.url());
		return (
			url.pathname === "/api/threads" &&
			url.searchParams.get("state") === "inbox" &&
			url.searchParams.get("filterType") === "battlepage"
		);
	});
	await battlepageFilter.click();
	await filteredRequest;

	const cards = page.getByTestId("thread-card");
	await expect(cards).toHaveCount(5);
	await expect(cards.first()).toContainText("filter-battlepage");
	await expect(page.getByText(/filter-arcalive thread/u)).toHaveCount(0);

	await page.getByRole("radio", { name: /All/u }).click();
	await expect(page.getByText(/filter-arcalive thread/u).first()).toBeVisible();
	await expect(page.getByText(/filter-battlepage thread/u).first()).toBeVisible();
});
