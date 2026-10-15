import { expect, test } from "@playwright/test";

test("상세는 한 번 클릭해 패널로 열고 원문 주소와 전체 URL을 제공한다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	const row = page.locator("article[data-bookmark-id]").first();
	await expect(row).toBeVisible();
	const link = row.getByRole("link").first();
	await expect(link).toHaveAttribute("href", /^https?:\/\//u);
	const url = await link.getAttribute("href");
	if (!url) throw new Error("원문 주소가 없습니다.");
	await row.getByRole("button", { name: "상세", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
	await expect(panel).toBeVisible();
	await expect(panel.getByText(url, { exact: true })).toBeVisible();
	await expect(panel.getByRole("button", { name: "주소 복사", exact: true })).toBeVisible();
	await panel.getByRole("button", { name: "닫기", exact: true }).click();
	await expect(panel).not.toBeVisible();
	await expect(row.getByRole("button", { name: "상세", exact: true })).toBeFocused();
});

test("초기 조회를 기다릴 때 행 골격을 표시하고 빈 상태를 표시하지 않는다", async ({ page }) => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/trpc/**", async (route) => {
		if (route.request().url().includes("bookmark.list")) await gate;
		await route.continue();
	});
	try {
		await page.goto("/main/bookmarks");
		await expect(page.getByTestId("bookmark-list-skeleton")).toBeVisible();
		await expect(page.getByText("표시할 북마크가 없습니다.", { exact: true })).toHaveCount(0);
		release();
		await expect(page.locator("article[data-bookmark-id]").first()).toBeVisible();
		await expect(page.getByTestId("bookmark-list-skeleton")).not.toBeVisible();
	} finally {
		release();
	}
});

test("모바일 상세 Drawer와 컬렉션 탐색은 겹치지 않고 화면 안에서 읽힌다", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/main/bookmarks");
	await page
		.locator("article[data-bookmark-id]")
		.first()
		.getByRole("button", { name: "상세", exact: true })
		.click();
	const detail = page.getByRole("dialog", { name: "북마크 상세", exact: true });
	await expect(detail).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await detail.getByRole("button", { name: "닫기", exact: true }).click();
	await page.getByRole("button", { name: "북마크 탐색", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "컬렉션 탐색", exact: true })).toBeVisible();
	await expect(detail).not.toBeVisible();
});

test("검색은 한글 조합 중 요청하지 않고 조합 완료 뒤 입력한 검색 결과를 보여준다", async ({
	page,
}) => {
	await page.goto("/main/bookmarks");
	await expect(page.locator("article[data-bookmark-id]").first()).toBeVisible();
	let requests = 0;
	page.on("request", (request) => {
		if (request.url().includes("bookmark.list")) requests++;
	});
	const search = page.getByRole("textbox", { name: "북마크 검색", exact: true });
	await search.dispatchEvent("compositionstart");
	await search.fill("존재하지않는북마크검색조건1792000000");
	await page.waitForTimeout(400);
	expect(requests).toBe(0);
	await search.dispatchEvent("compositionend");
	await expect(page.getByText("검색 결과가 없습니다.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "검색 초기화", exact: true }).click();
	await expect(page.locator("article[data-bookmark-id]").first()).toBeVisible();
});
