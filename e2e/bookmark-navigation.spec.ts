import { expect, test } from "@playwright/test";
import { bookmarkOwner } from "./support/bookmarks";

test("헤더 순서와 휴지통의 같은 문서 전환·기존 URL 진입을 확인한다", async ({ page }) => {
	const renderErrors: string[] = [];
	page.on("console", (event) => {
		if (event.type() === "error" && event.text().includes('unique "key"'))
			renderErrors.push(event.text());
	});
	await page.goto("/main/bookmarks?collection=unfiled");
	const header = page.getByRole("navigation", { name: "Main navigation", exact: true });
	await expect(header.getByRole("link", { name: "Bookmark", exact: true })).toBeVisible();
	expect((await header.getByRole("link").allTextContents()).map((name) => name.trim())).toEqual([
		"Main",
		"Quick",
		"Trash",
		"Bookmark",
		"Setting",
	]);
	await expect(page.getByRole("link", { name: /Raindrop/u })).toHaveCount(0);
	const sidebar = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
	const identity = await page.evaluate(() => performance.timeOrigin);
	await sidebar.getByRole("button", { name: "휴지통", exact: true }).click();
	await expect(page).toHaveURL(/\/main\/bookmarks\?state=trash$/u);
	await expect(sidebar.getByRole("button", { name: "휴지통", exact: true })).toHaveAttribute(
		"aria-current",
		"page"
	);
	await expect(page.getByRole("heading", { name: "휴지통", exact: true })).toBeVisible();
	expect(await page.evaluate(() => performance.timeOrigin)).toBe(identity);
	await sidebar.getByRole("button", { name: "전체 북마크", exact: true }).click();
	await expect(page).toHaveURL(/\/main\/bookmarks$/u);
	await sidebar.getByRole("button", { name: "미분류", exact: true }).click();
	await expect(page).toHaveURL(/collection=unfiled/u);
	await page.goto("/main/bookmarks/trash?search=legacy");
	await expect(page).toHaveURL(/\/main\/bookmarks\?state=trash&search=legacy$/u);
	await expect(sidebar).toBeVisible();
	await expect(page.getByRole("textbox", { name: "북마크 검색", exact: true })).toHaveValue(
		"legacy"
	);
	expect(renderErrors).toEqual([]);
});

test("트리만 화면 안에서 스크롤하고 우측 목록은 100개씩 이어서 불러온다", async ({ page }) => {
	const db = await bookmarkOwner();
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows).toHaveCount(100);
	const sidebar = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
	const tree = page.getByRole("region", { name: "컬렉션 트리", exact: true });
	const toggles = await sidebar
		.getByRole("button", { name: /하위 컬렉션 펼치기$/u })
		.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? ""));
	for (const name of toggles) await sidebar.getByRole("button", { name, exact: true }).click();
	const bounds = await tree.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			bottom: rect.bottom,
			viewport: window.innerHeight,
			overflow: getComputedStyle(element).overflowY,
			scrollable: element.scrollHeight > element.clientHeight,
		};
	});
	expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport);
	expect(bounds.overflow).toBe("auto");
	expect(bounds.scrollable).toBe(true);
	const sidebarTitleTop = await sidebar
		.getByRole("heading", { name: "컬렉션", exact: true })
		.evaluate((element) => element.getBoundingClientRect().top);
	await tree.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	expect(
		await sidebar
			.getByRole("heading", { name: "컬렉션", exact: true })
			.evaluate((element) => element.getBoundingClientRect().top)
	).toBe(sidebarTitleTop);
	const first = await rows.first().getAttribute("data-bookmark-id");
	await rows.first().getByRole("checkbox").check();
	await page.getByTestId("bookmark-load-more-sentinel").scrollIntoViewIfNeeded();
	await expect(rows).toHaveCount(200);
	expect(await rows.first().getAttribute("data-bookmark-id")).toBe(first);
	await expect(rows.first().getByRole("checkbox")).toBeChecked();
	const actual = await rows.evaluateAll((elements) =>
		elements.map((element) => element.getAttribute("data-bookmark-id"))
	);
	const expected = await Promise.all(
		[0, 100].map(async (offset) =>
			(
				await db.rpc("bookmark_snapshot", { p_filter: { state: "library", limit: 100, offset } })
			).data.items.map((item: { id: string }) => item.id)
		)
	);
	expect(actual).toEqual(expected.flat());
	expect(new Set(actual).size).toBe(200);
	await sidebar.getByRole("button", { name: "미분류", exact: true }).click();
	await expect(page.getByRole("combobox", { name: "작업 범위", exact: true })).toHaveValue(
		"selected"
	);
	await expect(page.getByText(/개 · 선택 0개$/u)).toBeVisible();
	await expect(page.getByRole("button", { name: "다음", exact: true })).toHaveCount(0);
	await page.screenshot({ path: "reports/bookmark-infinite-layout.png" });
});

test("다음 묶음 실패 시 기존 목록을 보존하고 재시도로 이어서 불러온다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows).toHaveCount(100);
	let interrupted = false;
	await page.route("**/api/trpc/bookmark.list*", async (route) => {
		const input = new URL(route.request().url()).searchParams.get("input") ?? "";
		if (!interrupted && input.includes('"offset":100')) {
			interrupted = true;
			await route.abort("failed");
		} else await route.continue();
	});
	await page.getByTestId("bookmark-load-more-sentinel").scrollIntoViewIfNeeded();
	await expect(page.getByRole("button", { name: "다시 불러오기", exact: true })).toBeVisible();
	await expect(rows).toHaveCount(100);
	const retryBounds = await page
		.getByRole("button", { name: "다시 불러오기", exact: true })
		.boundingBox();
	const paneBounds = await page.locator("[data-bookmark-scroll]").boundingBox();
	expect(retryBounds?.y).toBeGreaterThanOrEqual(paneBounds?.y ?? 0);
	expect((retryBounds?.y ?? 0) + (retryBounds?.height ?? 0)).toBeLessThanOrEqual(
		(paneBounds?.y ?? 0) + (paneBounds?.height ?? 0)
	);
	await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
	await expect(rows).toHaveCount(200);
	expect(interrupted).toBe(true);
});

test("목록 끝의 갱신 실패도 기존 항목을 보존하고 재시도한다", async ({ page }) => {
	await page.goto("/main/bookmarks?state=trash");
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows.first()).toBeVisible();
	await expect(page.getByText("목록 끝", { exact: true })).toBeVisible();
	const ids = await rows.evaluateAll((elements) =>
		elements.map((el) => el.getAttribute("data-bookmark-id"))
	);
	let interrupted = false;
	await page.route("**/api/trpc/bookmark.list*", async (route) => {
		if (!interrupted) {
			interrupted = true;
			await route.abort("failed");
		} else await route.continue();
	});
	await page.getByRole("button", { name: "목록 새로고침", exact: true }).click();
	await expect(page.getByRole("alert").filter({ hasText: "목록" })).toBeVisible({ timeout: 15000 });
	await expect(rows).toHaveCount(ids.length);
	await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
	await expect(page.getByRole("alert").filter({ hasText: "목록" })).toHaveCount(0);
	expect(
		await rows.evaluateAll((elements) => elements.map((el) => el.getAttribute("data-bookmark-id")))
	).toEqual(ids);
	expect(interrupted).toBe(true);
});

test("불러온 목록은 대기 중 반복 조회하지 않고 작업 상태만 갱신한다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows).toHaveCount(100);
	await page.getByTestId("bookmark-load-more-sentinel").scrollIntoViewIfNeeded();
	await expect(rows).toHaveCount(200);
	await page.locator("[data-bookmark-scroll]").evaluate((el) => {
		el.scrollTop = 0;
	});
	let listRequests = 0;
	let statusRequests = 0;
	page.on("request", (request) => {
		if (request.url().includes("/api/trpc/bookmark.list")) listRequests++;
		if (request.url().includes("/api/trpc/bookmarkImport.status")) statusRequests++;
	});
	await page.waitForTimeout(12000);
	expect(listRequests).toBe(0);
	expect(statusRequests).toBeGreaterThanOrEqual(2);
	await expect(rows).toHaveCount(200);
});

test("작업 기록은 목록 조회 없이 소유자 DB 작업 상태를 표시한다", async ({ page, browser }) => {
	const db = await bookmarkOwner();
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	expect(snapshot.error).toBeNull();
	let listRequests = 0;
	page.on("request", (request) => {
		if (request.url().includes("/api/trpc/bookmark.list")) listRequests++;
	});
	const status = page.waitForResponse(
		(response) => response.url().includes("/api/trpc/bookmarkImport.status") && response.ok()
	);
	await page.goto("/main/bookmarks/activity");
	const response = await status;
	const jobs = (await response.json())[0].result.data as {
		id: string;
		state: string;
		completed: number;
		failed: number;
	}[];
	expect(jobs).toEqual(snapshot.data.jobs);
	await expect(page.locator("article[data-bookmark-job-id]")).toHaveCount(jobs.length);
	expect(listRequests).toBe(0);
	const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	try {
		const denied = await anonymous.request.get(response.url());
		expect(denied.status()).toBe(401);
		expect(await denied.text()).not.toContain(jobs[0].id);
	} finally {
		await anonymous.close();
	}
});

test("같은 화면에서 휴지통 이동·복원을 수행하고 소속·원본을 DB에서 확인한다", async ({ page }) => {
	const db = await bookmarkOwner();
	const sample = await db
		.from("bookmarks")
		.select("*")
		.like("title", "수집 글 관리자 검증 %")
		.eq("state", "library")
		.is("collection_id", null)
		.order("saved_at", { ascending: false })
		.limit(1)
		.single();
	expect(sample.error).toBeNull();
	const item = sample.data;
	expect(item).toBeTruthy();
	if (!item) return;
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(item.title)}`);
	const row = page.locator(`[data-bookmark-id="${item.id}"]`);
	const sidebar = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
	try {
		await row.getByRole("checkbox").check();
		await page.getByRole("button", { name: "선택 항목 휴지통 이동", exact: true }).click();
		await expect(row).toHaveCount(0);
		const identity = await page.evaluate(() => performance.timeOrigin);
		await sidebar.getByRole("button", { name: "휴지통", exact: true }).click();
		await expect(row).toBeVisible();
		expect(await page.evaluate(() => performance.timeOrigin)).toBe(identity);
		expect(
			(await db.from("bookmarks").select("state").eq("id", item.id).single()).data?.state
		).toBe("trash");
		await row.getByRole("button", { name: "복원", exact: true }).click();
		await expect(row).toHaveCount(0);
		await sidebar.getByRole("button", { name: "미분류", exact: true }).click();
		await expect(row).toBeVisible();
		await page.reload();
		const restored = await db.from("bookmarks").select("*").eq("id", item.id).single();
		expect(restored.error).toBeNull();
		for (const key of [
			"state",
			"collection_id",
			"original",
			"tags",
			"note",
			"saved_at",
			"source_thread_id",
		])
			expect(restored.data?.[key]).toEqual(item[key]);
	} finally {
		const current = await db.from("bookmarks").select("state").eq("id", item.id).single();
		if (current.data?.state === "trash") {
			await page.goto(`/main/bookmarks?state=trash&search=${encodeURIComponent(item.title)}`);
			await row.getByRole("button", { name: "복원", exact: true }).click();
			await expect(row).toHaveCount(0);
		}
	}
});

test("모바일 검색창은 전체 너비를 쓰고 탐색을 선택하면 목록으로 돌아온다", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/main/bookmarks");
	await expect(page.locator("article[data-bookmark-id]")).toHaveCount(100);
	const search = await page
		.getByRole("textbox", { name: "북마크 검색", exact: true })
		.boundingBox();
	expect(search?.width).toBeGreaterThan(300);
	await page.getByRole("button", { name: "북마크 탐색", exact: true }).click();
	const sidebar = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
	await expect(sidebar).toBeVisible();
	await sidebar.getByRole("button", { name: "휴지통", exact: true }).click();
	await expect(sidebar).not.toBeVisible();
	await expect(page.getByRole("heading", { name: "휴지통", exact: true })).toBeVisible();
	const pane = await page.locator("[data-bookmark-scroll]").boundingBox();
	expect(pane?.height).toBeGreaterThan(200);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: "reports/bookmark-scroll-mobile.png" });
});

test("드래그 상태 안내가 나타나도 트리 높이와 드롭 대상 위치는 유지한다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	await expect(page.locator("article[data-bookmark-id]")).toHaveCount(100);
	const nodes = page
		.getByRole("region", { name: "컬렉션 트리", exact: true })
		.locator(":scope > ul > li > fieldset");
	const source = nodes.last();
	const target = nodes.nth((await nodes.count()) - 2);
	await source.hover();
	const before = await target.boundingBox();
	expect(before).toBeTruthy();
	if (!before) return;
	await page.mouse.down();
	try {
		await target.hover();
		await target.hover();
		await expect(target).toHaveAttribute("data-drop-state", "valid");
		await expect(target).toHaveAttribute("data-drop-position", "inside");
		await expect(page.getByRole("status").filter({ hasText: /의 하위로 이동$/u })).toBeVisible();
		const after = await target.boundingBox();
		expect(after?.y).toBe(before.y);
	} finally {
		await page.keyboard.press("Escape");
		await page.mouse.up();
	}
});
