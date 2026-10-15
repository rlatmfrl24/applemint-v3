import { expect, test } from "@playwright/test";
import { bookmarkOwner } from "./support/bookmarks";

test("휴지통 이동은 응답 전에 반영되고 실행 취소는 응답 버전으로 복원한다", async ({ page }) => {
	const db = await bookmarkOwner();
	await page.goto("/main/bookmarks");
	const first = page.locator("article[data-bookmark-id]").first();
	await expect(first).toBeVisible();
	const id = await first.getAttribute("data-bookmark-id");
	if (!id) throw new Error("항목 없음");
	const row = page.locator(`[data-bookmark-id="${id}"]`);
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/trpc/bookmark.trash*", async (route) => {
		await gate;
		await route.continue();
	});
	try {
		await row.getByRole("button", { name: /항목 메뉴/u }).click();
		await page.getByRole("menuitem", { name: "휴지통 이동", exact: true }).click();
		await expect(row).toHaveCount(0);
		expect((await db.from("bookmarks").select("state").eq("id", id).single()).data?.state).toBe(
			"library"
		);
		release();
		await page.getByRole("button", { name: "실행 취소", exact: true }).click();
		await expect(row).toBeVisible();
		await expect
			.poll(
				async () => (await db.from("bookmarks").select("state").eq("id", id).single()).data?.state
			)
			.toBe("library");
	} finally {
		release();
		await page.unroute("**/api/trpc/bookmark.trash*");
		const state = (await db.from("bookmarks").select("state,url").eq("id", id).single()).data;
		if (state?.state === "trash") {
			await page.goto(`/main/bookmarks?state=trash&search=${encodeURIComponent(state.url)}`);
			await page
				.locator(`[data-bookmark-id="${id}"]`)
				.getByRole("button", { name: "복원", exact: true })
				.click();
		}
	}
});

test("한 항목의 실패가 동시에 성공한 다른 항목을 복구하지 않는다", async ({ page }) => {
	const db = await bookmarkOwner();
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows.first()).toBeVisible();
	const a = await rows.nth(0).getAttribute("data-bookmark-id");
	const b = await rows.nth(1).getAttribute("data-bookmark-id");
	if (!a || !b) throw new Error("항목 부족");
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let first = true;
	await page.route("**/api/trpc/bookmark.trash*", async (route) => {
		if (first) {
			first = false;
			await gate;
			await route.abort();
		} else await route.continue();
	});
	try {
		for (const id of [a, b]) {
			await page
				.locator(`[data-bookmark-id="${id}"]`)
				.getByRole("button", { name: /항목 메뉴/u })
				.click();
			await page.getByRole("menuitem", { name: "휴지통 이동", exact: true }).click();
			await expect(page.locator(`[data-bookmark-id="${id}"]`)).toHaveCount(0);
		}
		await expect
			.poll(
				async () => (await db.from("bookmarks").select("state").eq("id", b).single()).data?.state
			)
			.toBe("trash");
		release();
		await expect(page.locator(`[data-bookmark-id="${a}"]`)).toBeVisible();
		await expect(page.locator(`[data-bookmark-id="${b}"]`)).toHaveCount(0);
	} finally {
		release();
		await page.unroute("**/api/trpc/bookmark.trash*");
		const state = (await db.from("bookmarks").select("state,url").eq("id", b).single()).data;
		if (state?.state === "trash") {
			await page.goto(`/main/bookmarks?state=trash&search=${encodeURIComponent(state.url)}`);
			await page
				.locator(`[data-bookmark-id="${b}"]`)
				.getByRole("button", { name: "복원", exact: true })
				.click();
			await expect
				.poll(
					async () => (await db.from("bookmarks").select("state").eq("id", b).single()).data?.state
				)
				.toBe("library");
		}
	}
});

test("상세 편집 중 다른 항목을 선택해도 확인 전에는 입력을 잃지 않는다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await rows.nth(0).getByRole("button", { name: "상세", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
	await panel.getByRole("button", { name: "수정", exact: true }).click();
	await panel.getByLabel("제목", { exact: true }).fill("아직 저장하지 않은 편집 내용");
	await rows.nth(1).getByRole("button", { name: "상세", exact: true }).click();
	const confirm = page.getByRole("alertdialog", { name: "편집 내용을 버릴까요?", exact: true });
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "계속 편집", exact: true }).click();
	await expect(panel.getByLabel("제목", { exact: true })).toHaveValue(
		"아직 저장하지 않은 편집 내용"
	);
	await panel.getByRole("button", { name: "닫기", exact: true }).click();
	await confirm.getByRole("button", { name: "변경 내용 버리기", exact: true }).click();
	await expect(panel).not.toBeVisible();
});

test("컬렉션 검색은 전체 경로로 구분하고 검색 결과로 바로 이동한다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	await page.getByLabel("컬렉션 검색", { exact: true }).fill("AI");
	await page.getByRole("button", { name: "study / AI", exact: true }).click();
	await expect(page.getByRole("heading", { name: "study / AI", exact: true })).toBeVisible();
	await expect(page.getByText("현재 컬렉션의 직접 소속 항목", { exact: true })).toBeVisible();
});

test("저장 팝업은 자동 추천 중 위치와 저장만 잠그고 요청 실패 후 수동 저장을 허용한다", async ({
	page,
}) => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let registered = 0;
	await page.route("**/api/trpc/**", async (route) => {
		const url = route.request().url();
		if (url.includes("bookmarkAI.recommend") && !url.includes("bookmarkAI.recommendation")) {
			registered++;
			await gate;
			await route.abort();
			return;
		}
		await route.continue();
	});
	try {
		await page.goto("/main");
		await page
			.locator('[data-thread-url^="http://www.slrclub.com/"]')
			.getByRole("button", { name: "북마크 저장", exact: true })
			.click();
		const dialog = page.getByRole("alertdialog", { name: "북마크 저장", exact: true });
		await expect(
			dialog.getByText("저장할 컬렉션을 추천하고 있어요", { exact: true })
		).toBeVisible();
		await expect(dialog.getByLabel("컬렉션", { exact: true })).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
		await expect(dialog.getByLabel("제목 (선택)")).toBeEnabled();
		await expect.poll(() => registered).toBe(1);
		release();
		await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
		await expect(dialog.getByRole("alert")).toBeVisible();
		await dialog.getByRole("button", { name: "취소", exact: true }).click();
	} finally {
		release();
	}
});

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
