import { expect, type Page, test } from "@playwright/test";
import { bookmarkOwner } from "./support/bookmarks";
import { seedBookmarkProposalDraft, seedBookmarkUXSource } from "./support/database";

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

test("컬렉션만 편집해도 닫기와 다른 항목 선택 전에 확인한다", async ({ page }) => {
	const db = await bookmarkOwner();
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	const target = snapshot.data.collections.find((c: { parent_id: string | null }) => !c.parent_id);
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await rows.first().getByRole("button", { name: "상세", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
	await panel.getByRole("button", { name: "수정", exact: true }).click();
	await panel.getByLabel("컬렉션", { exact: true }).click();
	await panel.locator(`[role="treeitem"][data-collection-id="${target.id}"]`).click();
	const confirm = page.getByRole("alertdialog", { name: "편집 내용을 버릴까요?", exact: true });
	await panel.getByRole("button", { name: "닫기", exact: true }).click();
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "계속 편집", exact: true }).click();
	await expect(panel.getByLabel("컬렉션", { exact: true })).toContainText(target.name);
	await rows.nth(1).getByRole("button", { name: "상세", exact: true }).click();
	await expect(confirm).toBeVisible();
});

test("편집 초안은 데스크톱과 Drawer 경계를 양방향으로 넘어도 유지된다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	await page
		.locator("article[data-bookmark-id]")
		.first()
		.getByRole("button", { name: "상세", exact: true })
		.click();
	let panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
	await panel.getByRole("button", { name: "수정", exact: true }).click();
	const fields = {
		제목: "화면 전환 중 보존할 제목",
		설명: "보존할 설명",
		태그: "보존, 초안",
		메모: "보존할 메모",
	};
	for (const [label, value] of Object.entries(fields))
		await panel.getByRole("textbox", { name: label, exact: true }).fill(value);
	for (const width of [1024, 390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		panel = page.getByRole(width >= 1280 ? "complementary" : "dialog", {
			name: "북마크 상세",
			exact: true,
		});
		for (const [label, value] of Object.entries(fields))
			await expect(panel.getByRole("textbox", { name: label, exact: true })).toHaveValue(value);
	}
});

test("보기 전환은 초안 버리기를 확인하고 계속 편집하면 입력을 유지한다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	await page
		.locator("article[data-bookmark-id]")
		.first()
		.getByRole("button", { name: "상세", exact: true })
		.click();
	const panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
	await panel.getByRole("button", { name: "수정", exact: true }).click();
	await panel.getByLabel("제목", { exact: true }).fill("보기를 바꾸기 전 초안");
	const review = page
		.getByRole("navigation", { name: "북마크 보기" })
		.getByRole("link", { name: "검토", exact: true });
	await review.click();
	const confirm = page.getByRole("alertdialog", { name: "편집 내용을 버릴까요?", exact: true });
	await expect(confirm).toBeVisible();
	await expect(page).toHaveURL(/\/main\/bookmarks$/u);
	await confirm.getByRole("button", { name: "계속 편집", exact: true }).click();
	await expect(panel.getByLabel("제목", { exact: true })).toHaveValue("보기를 바꾸기 전 초안");
	await review.click();
	await confirm.getByRole("button", { name: "변경 내용 버리기", exact: true }).click();
	await expect(page).toHaveURL(/\/main\/bookmarks\/review$/u);
});

test("AI 변경안의 대상과 새 이름은 패널과 Drawer 전환 및 갱신 후에도 유지된다", async ({
	page,
}) => {
	const fixture = seedBookmarkProposalDraft();
	const db = await bookmarkOwner();
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	const target = snapshot.data.collections[0];
	expect(target).toBeTruthy();
	try {
		await page.goto(`/main/bookmarks/review?search=${fixture.id}`);
		await page
			.locator(`[data-bookmark-id="${fixture.id}"]`)
			.getByRole("button", { name: "변경안", exact: true })
			.click();
		let panel = page.getByRole("complementary", { name: "검토 결과", exact: true });
		await panel.getByLabel("대상 컬렉션", { exact: true }).selectOption(target.id);
		await panel.getByLabel("새 컬렉션 이름", { exact: false }).fill("보존할 새 컬렉션");
		for (const width of [1024, 390, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			panel = page.getByRole(width >= 1280 ? "complementary" : "dialog", {
				name: "검토 결과",
				exact: true,
			});
			await expect(panel.getByLabel("대상 컬렉션", { exact: true })).toHaveValue(target.id);
			await expect(panel.getByLabel("새 컬렉션 이름", { exact: false })).toHaveValue(
				"보존할 새 컬렉션"
			);
		}
		await page.getByRole("button", { name: "목록 새로고침", exact: true }).click();
		await expect(panel.getByLabel("새 컬렉션 이름", { exact: false })).toHaveValue(
			"보존할 새 컬렉션"
		);
		await panel.getByRole("button", { name: "닫기", exact: true }).click();
		const confirm = page.getByRole("alertdialog", { name: "편집 내용을 버릴까요?", exact: true });
		await expect(confirm).toBeVisible();
		await confirm.getByRole("button", { name: "계속 편집", exact: true }).click();
		await expect(panel.getByLabel("새 컬렉션 이름", { exact: false })).toHaveValue(
			"보존할 새 컬렉션"
		);
		await panel.getByLabel("대상 컬렉션", { exact: true }).selectOption("");
		await expect(panel.getByLabel("새 컬렉션 이름", { exact: false })).toHaveValue("");
	} finally {
		fixture.cleanup();
	}
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
	const source = await seedBookmarkUXSource();
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
			.locator(`[data-thread-url=${JSON.stringify(source.url)}]`)
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
		const db = await bookmarkOwner();
		expect(
			(
				await db.rpc("transition_thread_state", {
					p_thread_id: Number(source.id),
					p_expected_state: "inbox",
					p_destination_state: "trash",
				})
			).error
		).toBeNull();
	}
});

test("데스크톱 상세는 제목에 초점을 두고 Tab으로 조작하며 Escape로 원래 항목에 돌아온다", async ({
	page,
}) => {
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	for (const index of [0, 1]) {
		const trigger = rows.nth(index).getByRole("button", { name: "상세", exact: true });
		await trigger.press("Enter");
		const panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
		const heading = panel.getByRole("heading", { name: "북마크 상세", exact: true });
		await expect(heading).toBeFocused();
		await expect(heading).toHaveCSS("outline-style", "solid");
		await page.keyboard.press("Tab");
		await expect(panel.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
		await panel.getByRole("button", { name: "수정", exact: true }).click();
		const input = panel.getByLabel("제목", { exact: true });
		await input.fill("초점을 빼앗기지 않는 미저장 입력");
		await expect(input).toBeFocused();
		await panel.getByRole("button", { name: "닫기", exact: true }).press("Escape");
		await page
			.getByRole("alertdialog", { name: "편집 내용을 버릴까요?", exact: true })
			.getByRole("button", { name: "변경 내용 버리기", exact: true })
			.click();
		await expect(panel).not.toBeVisible();
		await expect(trigger).toBeFocused();
	}
	await rows.first().getByRole("button", { name: "상세", exact: true }).press("Enter");
	const next = rows.nth(1).getByRole("button", { name: "상세", exact: true });
	await next.press("Enter");
	const panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
	await expect(panel.getByRole("heading", { name: "북마크 상세", exact: true })).toBeFocused();
	await panel.press("Escape");
	await expect(next).toBeFocused();
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

test("디자인 QA 화면 행렬에서 목록·트리·상세·설정·검토·기록·저장 진입을 확인한다", async ({
	page,
	context,
}) => {
	test.setTimeout(120000);
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	const viewports = [
		{ width: 1440, height: 900 },
		{ width: 1024, height: 768 },
		{ width: 390, height: 844 },
	];
	const reference = await context.newPage();
	for (const viewport of viewports) {
		await reference.setViewportSize(viewport);
		await reference.goto("http://127.0.0.1:3011/docs/design/bookmark-ux-reference.html");
		await reference.evaluate(() => document.fonts.ready.then(() => true));
		await reference.screenshot({ path: `reports/reference-${viewport.width}.png` });
		await page.setViewportSize(viewport);
		for (const theme of ["Dark", "Light"]) await captureBookmarkQA(page, viewport, theme);
	}
	await reference.close();
	expect(errors).toEqual([]);
});

async function captureBookmarkQA(
	page: Page,
	viewport: { width: number; height: number },
	theme: string
) {
	await page.goto("/main/bookmarks");
	await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
	await page.getByRole("menuitem", { name: theme, exact: true }).click();
	await expect(page.getByRole("menu")).toHaveCount(0);
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows).toHaveCount(100);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	if (viewport.width === 1440) {
		const count = await rows.evaluateAll(
			(els) =>
				els.filter((e) => {
					const r = e.getBoundingClientRect();
					return r.top >= 0 && r.bottom <= innerHeight;
				}).length
		);
		expect(count).toBeGreaterThanOrEqual(8);
	}
	await page.screenshot({ path: `reports/qa-${viewport.width}-${theme}-list.png` });
	await rows.first().getByRole("button", { name: "상세", exact: true }).press("Enter");
	const panel =
		viewport.width >= 1280
			? page.getByRole("complementary", { name: "북마크 상세", exact: true })
			: page.getByRole("dialog", { name: "북마크 상세", exact: true });
	await expect(panel.getByRole("button", { name: "주소 복사", exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: `reports/qa-${viewport.width}-${theme}-detail.png` });
	await panel.getByRole("button", { name: "닫기", exact: true }).click();
	if (viewport.width < 768) {
		await page.getByRole("button", { name: "북마크 탐색", exact: true }).click();
		await expect(page.getByRole("dialog", { name: "컬렉션 탐색", exact: true })).toBeVisible();
		await page.screenshot({ path: `reports/qa-${viewport.width}-${theme}-tree.png` });
		await page
			.getByRole("dialog", { name: "컬렉션 탐색", exact: true })
			.getByRole("button", { name: "닫기", exact: true })
			.click();
	}
	for (const route of [
		"/main/setting/bookmarks",
		"/main/bookmarks/review",
		"/main/bookmarks/activity",
	]) {
		await page.goto(route);
		if (route.includes("setting"))
			await expect(page.getByLabel("관심 주제 이름", { exact: true })).toBeVisible();
		else if (route.endsWith("activity"))
			await expect(page.locator("article[data-bookmark-job-id]").first()).toBeVisible();
		else
			await expect(page.getByRole("textbox", { name: "북마크 검색", exact: true })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({
			path: `reports/qa-${viewport.width}-${theme}-${route.includes("setting") ? "settings" : route.split("/").at(-1)}.png`,
		});
	}
	await page.goto("/main");
	const card = page.locator('[data-thread-url^="https://www.fmkorea.com/"]').first();
	await card.getByRole("button", { name: "북마크 저장", exact: true }).click();
	const save = page.getByRole("alertdialog");
	await expect(save.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
	await expect(save.getByText("사이트 일치", { exact: true })).toBeVisible();
	await page.screenshot({ path: `reports/qa-${viewport.width}-${theme}-save.png` });
	await save.getByRole("button", { name: "취소", exact: true }).click();
}

test("200%에 해당하는 CSS 화면과 모션 감소에서 패널과 키보드 초점이 유지된다", async ({
	browser,
}) => {
	const context = await browser.newContext({
		viewport: { width: 720, height: 450 },
		deviceScaleFactor: 2,
		reducedMotion: "reduce",
		storageState: "playwright/.auth/owner.json",
	});
	const page = await context.newPage();
	try {
		await page.goto("/main/bookmarks");
		const trigger = page
			.locator("article[data-bookmark-id]")
			.first()
			.getByRole("button", { name: "상세", exact: true });
		await trigger.press("Enter");
		const panel = page.getByRole("dialog", { name: "북마크 상세", exact: true });
		await expect(panel.getByRole("button", { name: "주소 복사", exact: true })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
		await page.screenshot({ path: "reports/qa-200pct-reduced-detail.png" });
		await panel.getByRole("button", { name: "닫기", exact: true }).press("Escape");
		await expect(trigger).toBeFocused();
	} finally {
		await context.close();
	}
});

test("폼 코드가 늦게 도착해도 저장 팝업 골격과 취소가 즉시 동작한다", async ({ page }) => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let held = false;
	let armed = false;
	await page.route("**/_next/static/chunks/*", async (route) => {
		if (armed && route.request().url().endsWith(".js")) {
			held = true;
			await gate;
		}
		await route.continue();
	});
	try {
		await page.goto("/main");
		const card = page.locator('[data-thread-url^="https://www.fmkorea.com/"]').first();
		await expect(card.getByRole("button", { name: "북마크 저장", exact: true })).toBeEnabled();
		armed = true;
		await card.getByRole("button", { name: "북마크 저장", exact: true }).click();
		await expect.poll(() => held).toBe(true);
		const dialog = page.getByRole("dialog", { name: "북마크 저장", exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute("aria-busy", "true");
		await dialog.getByRole("button", { name: "취소", exact: true }).press("Escape");
		await expect(dialog).not.toBeVisible();
		await expect(card.getByRole("button", { name: "북마크 저장", exact: true })).toBeFocused();
	} finally {
		release();
	}
});

test("30초 이후 수동 선택 전환은 진행 중 요청을 취소나 실패로 표시하지 않는다", async ({
	page,
}) => {
	await page.clock.install();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/trpc/bookmarkAI.recommend*", async (route) => {
		await gate;
		await route.abort();
	});
	try {
		await page.goto("/main");
		const card = page.locator('[data-thread-url^="https://nextjs.org/"]').first();
		await card.getByRole("button", { name: "북마크 저장", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		await expect(
			dialog.getByText("저장할 컬렉션을 추천하고 있어요", { exact: true })
		).toBeVisible();
		await page.clock.fastForward(30001);
		await dialog.getByRole("button", { name: "기다리지 않고 직접 선택", exact: true }).click();
		await expect(dialog.getByLabel("컬렉션", { exact: true })).toBeEnabled();
		await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
		await expect(dialog.getByRole("alert")).toHaveCount(0);
		release();
		await dialog.getByRole("button", { name: "취소", exact: true }).click();
	} finally {
		release();
	}
});

test("열린 상세 행을 강조하고 모바일에서는 상세 안에서 명시적으로 이동한다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	const row = page.locator("article[data-bookmark-id]").first();
	await row.getByRole("button", { name: "상세", exact: true }).click();
	await expect(row).toHaveAttribute("data-detail-selected", "true");
	await page
		.getByRole("complementary", { name: "북마크 상세", exact: true })
		.getByRole("button", { name: "닫기", exact: true })
		.click();
	await page.setViewportSize({ width: 390, height: 844 });
	await row.getByRole("button", { name: "상세", exact: true }).click();
	const detail = page.getByRole("dialog", { name: "북마크 상세", exact: true });
	await detail.getByRole("button", { name: "컬렉션 이동", exact: true }).click();
	await expect(page.getByRole("alertdialog", { name: "컬렉션 이동", exact: true })).toBeVisible();
});

async function moveVisibleBookmark(
	page: Page,
	id: string,
	target: { id: string; name: string } | null
) {
	await page
		.locator(`[data-bookmark-id="${id}"]`)
		.getByRole("button", { name: /항목 메뉴/u })
		.click();
	await page.getByRole("menuitem", { name: "컬렉션 이동", exact: true }).click();
	const dialog = page.getByRole("alertdialog", { name: "컬렉션 이동", exact: true });
	await dialog.getByLabel("컬렉션", { exact: true }).click();
	if (target)
		await dialog.getByRole("searchbox", { name: "컬렉션 검색", exact: true }).fill(target.name);
	await dialog.locator(`[role="treeitem"][data-collection-id="${target?.id ?? ""}"]`).click();
	await dialog.getByRole("button", { name: "이동", exact: true }).click();
	await expect(dialog).not.toBeVisible();
}
test("200개 로드 뒤 이동·삭제·추가 로딩을 해도 DB 순서와 ID 중복·누락이 없다", async ({ page }) => {
	test.setTimeout(90000);
	const db = await bookmarkOwner();
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows).toHaveCount(100);
	const id = await rows.first().getAttribute("data-bookmark-id");
	if (!id) throw new Error("항목 없음");
	const before = (
		await db.from("bookmarks").select("url,state,collection_id").eq("id", id).single()
	).data;
	if (!before) throw new Error("북마크 없음");
	const collections =
		(await db.from("bookmark_collections").select("id,name").is("archived_at", null)).data ?? [];
	const original = collections.find((c) => c.id === before.collection_id) ?? null;
	const target = original ? null : collections[0];
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		await page.getByTestId("bookmark-load-more-sentinel").scrollIntoViewIfNeeded();
		await expect(rows).toHaveCount(200);
		await moveVisibleBookmark(page, id, target);
		expect(
			(await db.from("bookmarks").select("collection_id").eq("id", id).single()).data?.collection_id
		).toBe(target?.id ?? null);
		await page.route("**/api/trpc/bookmark.trash*", async (route) => {
			await gate;
			await route.continue();
		});
		await page
			.locator(`[data-bookmark-id="${id}"]`)
			.getByRole("button", { name: /항목 메뉴/u })
			.click();
		await page.getByRole("menuitem", { name: "휴지통 이동", exact: true }).click();
		await expect(rows).toHaveCount(199);
		release();
		await expect(rows).toHaveCount(200);
		await page.getByTestId("bookmark-load-more-sentinel").scrollIntoViewIfNeeded();
		await expect(rows).toHaveCount(300);
		const actual = await rows.evaluateAll((els) =>
			els.map((el) => el.getAttribute("data-bookmark-id"))
		);
		const expected = (
			await Promise.all(
				[0, 100, 200].map(async (offset) =>
					(
						await db.rpc("bookmark_snapshot", {
							p_filter: { state: "library", limit: 100, offset },
						})
					).data.items.map((item: { id: string }) => item.id)
				)
			)
		).flat();
		expect(new Set(actual).size).toBe(300);
		expect(actual).toEqual(expected);
	} finally {
		release();
		await page.unroute("**/api/trpc/bookmark.trash*");
		const state = (await db.from("bookmarks").select("state").eq("id", id).single()).data?.state;
		if (state === "trash") {
			await page.goto(`/main/bookmarks?state=trash&search=${encodeURIComponent(before.url)}`);
			await page
				.locator(`[data-bookmark-id="${id}"]`)
				.getByRole("button", { name: "복원", exact: true })
				.click();
			await expect(page.locator(`[data-bookmark-id="${id}"]`)).toHaveCount(0);
		}
		await page.goto(`/main/bookmarks?search=${encodeURIComponent(before.url)}`);
		await moveVisibleBookmark(page, id, original);
		expect(
			(await db.from("bookmarks").select("state,collection_id").eq("id", id).single()).data
		).toEqual({ state: before.state, collection_id: before.collection_id });
	}
});

test("한 항목을 이동하는 동안에도 다른 항목의 상세를 탐색할 수 있다", async ({ page }) => {
	const db = await bookmarkOwner();
	await page.goto("/main/bookmarks");
	const rows = page.locator("article[data-bookmark-id]");
	await expect(rows).toHaveCount(100);
	const id = await rows.first().getAttribute("data-bookmark-id");
	const current = (await db.from("bookmarks").select("collection_id").eq("id", id).single()).data
		?.collection_id;
	const target = (
		await db
			.from("bookmark_collections")
			.select("id,name")
			.is("parent_id", null)
			.is("archived_at", null)
	).data?.find((c) => c.id !== current);
	if (!target) throw new Error("이동 대상 없음");
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/trpc/bookmarkCollection.moveMany*", async (route) => {
		await gate;
		await route.abort();
	});
	try {
		await rows
			.first()
			.dragTo(
				page
					.getByRole("navigation", { name: "북마크 탐색", exact: true })
					.getByRole("button", { name: target.name, exact: true })
			);
		await expect(rows.first().getByRole("checkbox")).toBeDisabled();
		const other = rows.nth(1).getByRole("button", { name: "상세", exact: true });
		await expect(other).toBeEnabled();
		await other.click();
		await expect(
			page.getByRole("complementary", { name: "북마크 상세", exact: true })
		).toBeVisible();
	} finally {
		release();
	}
});
