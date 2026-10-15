import { expect, test } from "@playwright/test";
import { bookmarkOwner, removeCollectionUI, saveSourceBookmark } from "./support/bookmarks";

test("수집 글 저장·수정·열기·휴지통·복원과 컬렉션 삭제를 UI와 DB에서 확인한다", async ({
	page,
	context,
}) => {
	const db = await bookmarkOwner();
	const title = `수집 글 관리자 검증 ${Date.now()}`;
	const saved = await saveSourceBookmark(page, db, title);
	await page.goto("/main");
	await page
		.locator(`[data-thread-url=${JSON.stringify(saved.url)}]`)
		.getByRole("button", { name: "북마크 저장", exact: true })
		.click();
	await page.getByRole("alertdialog").getByRole("button", { name: "저장", exact: true }).click();
	await expect(
		page.getByText("이미 저장한 URL입니다. 기존 북마크를 확인해주세요.", { exact: true })
	).toBeVisible();
	expect(
		(await db.from("bookmarks").select("id", { count: "exact" }).eq("url", saved.url)).count
	).toBe(1);
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(title)}`);
	const row = page.locator(`[data-bookmark-id="${saved.id}"]`);
	await expect(row).toBeVisible();
	const popup = context.waitForEvent("page");
	await row.getByRole("link", { name: title, exact: true }).click();
	await (await popup).close();
	await expect(row).toContainText("열기 1회");
	expect(
		(await db.from("bookmarks").select("open_count").eq("id", saved.id).single()).data?.open_count
	).toBe(1);

	await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
	let dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(title);
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const collection = await db.from("bookmark_collections").select("id").eq("name", title).single();
	expect(collection.error).toBeNull();
	await row.getByRole("button", { name: `${title} 항목 메뉴`, exact: true }).click();
	await page.getByRole("menuitem", { name: "수정", exact: true }).click();
	dialog = page.getByRole("complementary", { name: "북마크 수정", exact: true });
	await dialog.getByLabel("컬렉션", { exact: true }).click();
	await dialog
		.getByRole("tree", { name: "컬렉션 선택" })
		.getByRole("treeitem", { name: title, exact: true })
		.click();
	await dialog.getByRole("textbox", { name: "메모", exact: true }).fill("복원 후에도 유지");
	await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(row).toContainText(title);
	await row.getByRole("checkbox").check();
	await page.getByRole("button", { name: "선택 항목 휴지통 이동", exact: true }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/main/bookmarks/trash?search=${encodeURIComponent(title)}`);
	await expect(row).toContainText(title);
	await removeCollectionUI(page, title);
	await page.goto(`/main/bookmarks/trash?search=${encodeURIComponent(title)}`);
	await expect(row).toContainText("미분류");
	await expect(row).toContainText(`이전: ${title}`);
	await row.getByRole("checkbox").check();
	await page.getByRole("button", { name: "선택 항목 복원", exact: true }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(title)}`);
	await expect(row).toBeVisible();
	const after = await db
		.from("bookmarks")
		.select("state,note,collection_id,previous_collection_path,source_thread_id,original")
		.eq("id", saved.id)
		.single();
	expect(after.error).toBeNull();
	expect(after.data).toMatchObject({
		state: "library",
		note: "복원 후에도 유지",
		collection_id: null,
		previous_collection_path: title,
		source_thread_id: saved.source_thread_id,
	});
	expect(after.data?.original).toEqual(saved.original);
	await row.getByRole("button", { name: `${title} 항목 메뉴`, exact: true }).click();
	await page.getByRole("menuitem", { name: "상세", exact: true }).click();
	await expect(page.getByRole("complementary", { name: "북마크 상세", exact: true })).toContainText(
		"복원 후에도 유지"
	);
	await page.getByRole("button", { name: "닫기", exact: true }).click();
	await expect(row.getByRole("button", { name: `${title} 항목 메뉴`, exact: true })).toBeFocused();
	console.log(
		"SOURCE_MANAGER_READBACK",
		JSON.stringify({
			saved: true,
			sourceStatePreserved: true,
			opened: 1,
			deletedCollectionArchived: true,
			previousPath: true,
			restored: true,
		})
	);
});

test("검토 유형별 수량·추가 로드가 DB와 일치하고 선택·기존 진입 조건을 보존한다", async ({
	page,
}) => {
	const db = await bookmarkOwner();
	await page.goto("/main/bookmarks/review");
	for (const [type, label] of [
		["dead", "죽은 링크"],
		["classify", "컬렉션 변경안"],
		["unused", "미사용 후보"],
		["all", "전체"],
	]) {
		await page.getByRole("button", { name: label, exact: true }).click();
		const snapshot = await db.rpc("bookmark_snapshot", {
			p_filter: { review: true, reviewType: type, limit: 100 },
		});
		expect(snapshot.error).toBeNull();
		await expect(page.locator("article[data-bookmark-id]")).toHaveCount(snapshot.data.items.length);
		await expect(
			page.getByText(`${snapshot.data.total.toLocaleString()}개 · 선택 0개`, { exact: true })
		).toBeVisible();
	}
	await page.getByLabel("불러온 항목 선택", { exact: true }).check();
	await page.getByTestId("bookmark-load-more-sentinel").scrollIntoViewIfNeeded();
	await expect(page.locator("article[data-bookmark-id]")).toHaveCount(200);
	await expect(page.getByText(/개 · 선택 100개$/u)).toBeVisible();
	await page.getByRole("button", { name: "죽은 링크", exact: true }).click();
	await expect(page.getByLabel("불러온 항목 선택", { exact: true })).not.toBeChecked();
	await page.goto("/main/bookmarks?state=trash&search=legacy-query");
	await expect(page).toHaveURL(/\/bookmarks\?state=trash&search=legacy-query/u);
	await expect(page.getByLabel("북마크 검색")).toHaveValue("legacy-query");
	await page.goto("/main/setting/bookmarks");
	await page.getByRole("link", { name: "작업 기록 보기", exact: true }).click();
	await expect(page).toHaveURL(/\/activity$/u);
});

test("수동 링크 검사 후 검토 유지·휴지통·복원을 실제 UI에서 처리한다", async ({ page }) => {
	test.skip(
		process.env.BOOKMARK_LIVE_CHECK !== "1",
		"외부 링크 재검사는 명시한 로컬 실행에서만 수행"
	);
	test.setTimeout(240000);
	const db = await bookmarkOwner();
	// Previously saved ordinary QA URL; no removed manager save control or synthetic source is introduced.
	const sample = await db
		.from("bookmarks")
		.select("id,url,title,state,version")
		.like("url", "https://example.com/applemint-dead-%")
		.is("source_id", null)
		.order("saved_at", { ascending: false })
		.limit(1)
		.single();
	expect(sample.error).toBeNull();
	if (sample.data?.state === "trash")
		expect(
			(
				await db.rpc("bookmark_command", {
					p_action: "restore",
					p_input: { id: sample.data.id, version: sample.data.version },
				})
			).error
		).toBeNull();
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(sample.data?.url)}`);
	const row = page.locator(`[data-bookmark-id="${sample.data?.id}"]`);
	await row.getByRole("checkbox").check();
	const started = new Date().toISOString();
	await page.getByRole("button", { name: "링크 검사", exact: true }).click();
	await expect
		.poll(
			async () => {
				const result = await db
					.from("bookmark_checks")
					.select("id")
					.eq("bookmark_id", sample.data?.id)
					.gte("checked_at", started)
					.limit(1)
					.maybeSingle();
				expect(result.error).toBeNull();
				return result.data?.id ?? null;
			},
			{ timeout: 180000, intervals: [1000, 2000, 5000] }
		)
		.not.toBeNull();
	await expect(row.getByText("죽은 링크 의심", { exact: true })).toBeVisible({ timeout: 180000 });
	await page.goto(
		`/main/bookmarks/review?type=dead&search=${encodeURIComponent(sample.data?.url)}`
	);
	await expect(row).toContainText("1분 뒤 재검사");
	await row.getByRole("button", { name: "근거", exact: true }).click();
	const panel = page.getByRole("complementary", { name: "검토 결과", exact: true });
	await expect(panel).toContainText("404");
	await panel.getByRole("button", { name: "닫기", exact: true }).click();
	await row.getByRole("button", { name: "유지", exact: true }).click();
	await expect(row).toHaveCount(0);
	await page.reload();
	await expect(row).toHaveCount(0);
	const check = await db
		.from("bookmark_checks")
		.select("status,reviewed_at")
		.eq("bookmark_id", sample.data?.id)
		.order("checked_at", { ascending: false })
		.limit(1)
		.single();
	expect(check.data?.status).toBe("dead");
	expect(check.data?.reviewed_at).toBeTruthy();
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(sample.data?.url)}`);
	await row.getByRole("button", { name: `${sample.data?.title} 항목 메뉴`, exact: true }).click();
	await page.getByRole("menuitem", { name: "휴지통 이동", exact: true }).click();
	await page.goto(`/main/bookmarks/trash?search=${encodeURIComponent(sample.data?.url)}`);
	await row.getByRole("button", { name: "복원", exact: true }).click();
	await expect(row).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(await db.from("bookmarks").select("state").eq("id", sample.data?.id).single()).data?.state
		)
		.toBe("library");
	console.log(
		"REVIEW_KEEP_READBACK",
		JSON.stringify({ dead: true, keptNotRepeated: true, trashedAndRestored: true })
	);
});

test("완료된 일회 이관은 설정 화면에서 재실행할 수 없다", async ({ page }) => {
	test.skip(process.env.BOOKMARK_IMPORTED_LIBRARY !== "1", "완료된 로컬 이관 자료 검증");
	await page.goto("/main/setting/bookmarks");
	const summary = page.locator("summary").filter({ hasText: "Raindrop 가져오기" });
	await expect(summary).toContainText("완료");
	await expect(summary.locator("..")).not.toHaveAttribute("open");
	await summary.click();
	await expect(page.getByText(/이관 완료 · 새 이관은 비활성화/u)).toBeVisible();
	await expect(
		page.getByRole("button", { name: /최초 가져오기 시작|기존 이관 작업 재개/u })
	).toHaveCount(0);
	await expect(page.getByText(/검증 일치/u)).toBeVisible();
});
