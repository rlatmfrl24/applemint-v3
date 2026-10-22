import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { collectionAncestors } from "../lib/bookmark-tree";
import { bookmarkOwner, removeCollectionUI } from "./support/bookmarks";
import { getE2ERuntime } from "./support/runtime";

test("자동 실행 서버의 북마크 API와 내부 worker 경로가 등록된다", async ({ page }) => {
	const collections = await page.request.get("/api/trpc/bookmarkCollection.list");
	expect(collections.status()).toBe(200);
	expect(Array.isArray((await collections.json()).result.data)).toBe(true);
	expect((await page.request.get("/api/bookmarks/worker")).status()).toBe(405);
	expect((await page.request.post("/api/bookmarks/worker", { data: {} })).status()).toBe(401);
});

test("목록 갱신이 실패해도 새 컬렉션을 트리에서 관리할 수 있다", async ({ page }) => {
	const db = await bookmarkOwner();
	const name = `컬렉션 갱신 검증 ${Date.now()}`;
	await page.goto("/main/bookmarks");
	await expect(page.locator("article[data-bookmark-id]")).toHaveCount(100);
	await page.route("**/api/trpc/bookmark.list**", (route) => route.abort());
	let createdId: string | undefined;
	try {
		await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(name);
		await dialog.getByRole("button", { name: "저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		const created = await db.from("bookmark_collections").select("id").eq("name", name).single();
		expect(created.error).toBeNull();
		createdId = created.data?.id;
		await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
	} finally {
		await page.unroute("**/api/trpc/bookmark.list**");
		if (createdId) await removeCollectionUI(page, name, createdId);
	}
});

test("현재 컬렉션을 떠난 선택 항목으로 AI 작업을 실행할 수 없다", async ({ page }) => {
	const db = await bookmarkOwner();
	const sample = await db
		.from("bookmarks")
		.select("id,title,collection_id")
		.like("title", "수집 글 관리자 검증 %")
		.eq("state", "library")
		.order("saved_at", { ascending: false })
		.limit(1)
		.single();
	expect(sample.error).toBeNull();
	expect(sample.data?.collection_id).toBeNull();
	const name = `선택 경계 검증 ${Date.now()}`;
	await page.goto("/main/bookmarks");
	await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
	let dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(name);
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const collection = await db.from("bookmark_collections").select("id").eq("name", name).single();
	try {
		await page.goto(
			`/main/bookmarks?collection=unfiled&search=${encodeURIComponent(sample.data?.title)}`
		);
		const row = page.locator(`[data-bookmark-id="${sample.data?.id}"]`);
		await row.getByRole("checkbox").check();
		await row.getByRole("button", { name: `${sample.data?.title} 항목 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "수정", exact: true }).click();
		dialog = page.getByRole("complementary", { name: "북마크 수정", exact: true });
		await dialog.getByLabel("컬렉션", { exact: true }).click();
		await dialog
			.getByRole("tree", { name: "컬렉션 선택" })
			.getByRole("treeitem", { name, exact: true })
			.click();
		await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(row).toHaveCount(0);
		await expect(page.getByRole("button", { name: "AI 정리", exact: true })).toBeDisabled();
		await expect(page.getByText("0개 · 선택 0개", { exact: true })).toBeVisible();
		expect(
			(await db.from("bookmarks").select("collection_id").eq("id", sample.data?.id).single()).data
				?.collection_id
		).toBe(collection.data?.id);
	} finally {
		await removeCollectionUI(page, name, collection.data?.id);
	}
});

test("허용된 160자 컬렉션 이름은 모바일 제목에서 가로 넘침을 만들지 않는다", async ({ page }) => {
	const db = await bookmarkOwner();
	const name = String(Date.now()).padEnd(160, "L");
	await page.goto("/main/bookmarks");
	await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(name);
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const collection = await db
		.from("bookmark_collections")
		.select("id")
		.eq("name", name)
		.is("archived_at", null)
		.single();
	expect(collection.error).toBeNull();
	try {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto(`/main/bookmarks?collection=${collection.data?.id}`);
		await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	} finally {
		await page.setViewportSize({ width: 1440, height: 900 });
		await removeCollectionUI(page, name, collection.data?.id);
	}
});

test("컬렉션과 항목 메뉴를 Escape로 닫으면 트리거에 키보드 초점이 돌아온다", async ({ page }) => {
	const db = await bookmarkOwner();
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	const root = snapshot.data.collections.find(
		(collection: { parent_id: string | null }) => collection.parent_id === null
	);
	await page.goto("/main/bookmarks");
	const treeTrigger = page.getByRole("button", { name: `${root.name} 메뉴`, exact: true });
	await treeTrigger.click();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).not.toBeVisible();
	await expect.soft(treeTrigger).toBeFocused();
	const rowTrigger = page
		.locator("article[data-bookmark-id]")
		.first()
		.getByRole("button", { name: /항목 메뉴$/u });
	await rowTrigger.click();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).not.toBeVisible();
	await expect.soft(rowTrigger).toBeFocused();
});

test("관리자는 계층과 팝업을 제공하고 저장·설정 바로가기를 표시하지 않는다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	await expect(page.getByRole("button", { name: "Bookmark", exact: true })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "북마크 설정", exact: true })).toHaveCount(0);
	await expect(
		page
			.getByRole("navigation", { name: "북마크 보기" })
			.getByRole("link", { name: "휴지통", exact: true })
	).toHaveCount(0);
	const sidebar = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
	const collections = sidebar.getByRole("region", { name: "컬렉션", exact: true });
	await expect(collections.getByRole("button", { name: "컬렉션 추가", exact: true })).toBeVisible();
	const order = await sidebar.evaluate((nav) => {
		const unfiled = [...nav.querySelectorAll("button")].find(
			(button) => button.textContent === "미분류"
		);
		const trash = [...nav.querySelectorAll("button")].find(
			(button) => button.textContent === "휴지통"
		);
		const heading = nav.querySelector("h2");
		return {
			unfiled: unfiled?.getBoundingClientRect().top,
			trash: trash?.getBoundingClientRect().top,
			heading: heading?.getBoundingClientRect().top,
		};
	});
	expect(order.trash).toBeGreaterThan(order.unfiled ?? Number.POSITIVE_INFINITY);
	expect(order.heading).toBeGreaterThan(order.trash ?? Number.POSITIVE_INFINITY);
	await expect(page.getByRole("button", { name: "컬렉션 추가", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toBeVisible();
	await expect(page.getByLabel("상위 컬렉션", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "취소", exact: true }).click();
	await expect(page.getByRole("button", { name: "컬렉션 추가", exact: true })).toBeFocused();
	await sidebar.getByRole("button", { name: "휴지통", exact: true }).click();
	await expect(page).toHaveURL(/\/main\/bookmarks\?state=trash$/u);
	await expect(
		page.locator("main").getByRole("heading", { name: "휴지통", exact: true })
	).toBeVisible();
	await page
		.getByRole("navigation", { name: "북마크 보기" })
		.getByRole("link", { name: "북마크", exact: true })
		.click();
	await expect(page).toHaveURL(/\/main\/bookmarks$/u);
});

test("실제 깊은 계층을 선택하면 조상이 펼쳐지고 접기 상태가 세션에 남는다", async ({ page }) => {
	const db = await bookmarkOwner();
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	expect(snapshot.error).toBeNull();
	const collections = snapshot.data.collections;
	const deep = [...collections].sort(
		(a, b) =>
			collectionAncestors(b.id, collections).length - collectionAncestors(a.id, collections).length
	)[0];
	const ancestors = collectionAncestors(deep.id, collections);
	expect(ancestors.length).toBeGreaterThanOrEqual(2);
	await page.goto(`/main/bookmarks?collection=${deep.id}`);
	await expect(page.getByRole("button", { name: deep.name, exact: true })).toHaveAttribute(
		"aria-current",
		"page"
	);
	const root = collections.find((collection: { id: string }) => collection.id === ancestors.at(-1));
	await page.getByRole("button", { name: `${root.name} 하위 컬렉션 접기`, exact: true }).click();
	await expect(page.getByRole("button", { name: deep.name, exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "전체 북마크", exact: true }).click();
	await page.reload();
	await expect(
		page.getByRole("button", { name: `${root.name} 하위 컬렉션 펼치기`, exact: true })
	).toHaveAttribute("aria-expanded", "false");
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(page.getByRole("navigation", { name: "북마크 탐색" })).not.toBeVisible();
	await page.getByRole("button", { name: "북마크 탐색", exact: true }).click();
	await expect(page.getByRole("navigation", { name: "북마크 탐색" })).toBeVisible();
});

test("작업 기록에서 실제 실패한 메타데이터 작업을 같은 작업으로 재개한다", async ({ page }) => {
	test.skip(process.env.BOOKMARK_RESUME !== "1", "이 로컬 검증에서 생성한 실패 작업만 재개");
	const db = await bookmarkOwner();
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	expect(snapshot.error).toBeNull();
	const job = snapshot.data.jobs.find(
		(item: { kind: string; state: string }) => item.kind === "metadata" && item.state === "partial"
	);
	expect(job).toBeTruthy();
	const items = await db.from("bookmark_job_items").select("bookmark_id").eq("job_id", job.id);
	const source = await db
		.from("bookmarks")
		.select("source_id,title")
		.eq("id", items.data?.[0].bookmark_id)
		.single();
	expect(source.data?.source_id).toBeNull();
	expect(source.data?.title).toMatch(/관리자 검증/u);
	await page.goto("/main/bookmarks/activity");
	const row = page.locator(`[data-bookmark-job-id="${job.id}"]`);
	await row.getByText("실패·재검사·미처리 항목 확인", { exact: true }).click();
	await expect(row).toContainText("실패");
	await row.getByRole("button", { name: "같은 작업 재개", exact: true }).click();
	await expect(page.getByText("같은 작업을 재개했습니다.", { exact: true })).toBeVisible();
	const after = await db.from("bookmark_jobs").select("id,state").eq("id", job.id).single();
	expect(after.data).toMatchObject({ id: job.id, state: "queued" });
	expect(
		(await db.from("bookmark_job_items").select("state,error").eq("job_id", job.id)).data
	).toEqual([{ state: "pending", error: null }]);
	console.log("ACTIVITY_RESUME_READBACK", JSON.stringify({ sameJob: true, pendingAgain: true }));
});

test("확인된 테스트 컬렉션을 삭제 팝업으로 정리하되 모든 북마크를 보존한다", async ({ page }) => {
	test.skip(process.env.BOOKMARK_CLEANUP !== "1", "확인된 로컬 QA 컬렉션 정리 실행에서만 수행");
	const db = await bookmarkOwner();
	const names = [
		"AI 검증 정리 1791868938290",
		"AI 검증 정리 1791869523870",
		"수집 글 관리자 검증 1791879338631",
		"L".repeat(160),
	];
	let cleaned = 0;
	for (const name of names) {
		const collection = await db
			.from("bookmark_collections")
			.select("id,source_id,archived_at")
			.eq("name", name)
			.single();
		expect(collection.error).toBeNull();
		expect(collection.data?.source_id).toBeNull();
		if (collection.data?.archived_at) continue;
		const members = await db
			.from("bookmarks")
			.select("id,state,note,tags,saved_at,source_id,original")
			.eq("collection_id", collection.data?.id);
		expect(members.error).toBeNull();
		await removeCollectionUI(page, name);
		const archived = await db
			.from("bookmark_collections")
			.select("archived_at")
			.eq("id", collection.data?.id)
			.single();
		expect(archived.data?.archived_at).toBeTruthy();
		for (const member of members.data ?? []) {
			const after = await db
				.from("bookmarks")
				.select(
					"id,state,note,tags,saved_at,source_id,original,collection_id,previous_collection_path"
				)
				.eq("id", member.id)
				.single();
			expect(after.error).toBeNull();
			expect(after.data).toMatchObject({
				...member,
				collection_id: null,
				previous_collection_path: name,
			});
		}
		cleaned++;
	}
	console.log(
		"QA_COLLECTION_CLEANUP_READBACK",
		JSON.stringify({ archived: cleaned, originalsAndMembersPreserved: true })
	);
});

test("데스크톱 밀도·테마·키보드 초점과 모바일 첫 목록·가로 넘침을 확인한다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	await expect(page.locator("article[data-bookmark-id]")).toHaveCount(100);
	const count = await page.locator("article[data-bookmark-id]").evaluateAll(
		(rows) =>
			rows.filter((row) => {
				const rect = row.getBoundingClientRect();
				return rect.top >= 0 && rect.bottom <= window.innerHeight;
			}).length
	);
	expect(count).toBeGreaterThanOrEqual(8);
	await page.screenshot({ path: "reports/bookmark-manager-light.png" });
	await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
	await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
	await expect(page.locator("html")).toHaveClass(/dark/u);
	await expect(page.getByRole("menu")).not.toBeVisible();
	await page.screenshot({ path: "reports/bookmark-manager-dark.png" });
	await page.getByRole("button", { name: "컬렉션 추가", exact: true }).press("Enter");
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Tab");
	expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
	await dialog.getByRole("button", { name: "취소", exact: true }).press("Enter");
	await expect(page.getByRole("button", { name: "컬렉션 추가", exact: true })).toBeFocused();
	await page.setViewportSize({ width: 375, height: 812 });
	await page.reload();
	await expect(page.locator("article[data-bookmark-id]")).toHaveCount(100);
	const first = await page.locator("article[data-bookmark-id]").first().boundingBox();
	expect(first?.y).toBeLessThan(650);
	for (const route of ["", "/review", "/trash", "/activity"]) {
		await page.goto(`/main/bookmarks${route}`);
		await expect(page.getByRole("navigation", { name: "북마크 보기" })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	}
	await page.goto("/main/bookmarks");
	await page.screenshot({ path: "reports/bookmark-manager-mobile.png" });
	console.log(
		"MANAGER_VISUAL_READBACK",
		JSON.stringify({
			visibleRows1440x900: count,
			mobileWidth: 375,
			overflow: false,
			keyboardFocusRestored: true,
		})
	);
});
test("컬렉션 팝업으로 계층 생성·이름 수정·삭제하고 DB에서 재조회한다", async ({ page }) => {
	const runtime = getE2ERuntime();
	const db = createClient(runtime.supabaseUrl, runtime.publishableKey, {
		auth: { persistSession: false },
	});
	expect(
		(
			await db.auth.signInWithPassword({
				email: runtime.ownerEmail,
				password: runtime.ownerPassword,
			})
		).error
	).toBeNull();
	const rootName = `관리자 UI 검증 ${Date.now()}`;
	const childName = `${rootName} 하위`;
	const renamed = `${rootName} 수정`;
	const created: string[] = [];
	await page.goto("/main/bookmarks");
	try {
		await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
		let dialog = page.getByRole("alertdialog");
		await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(rootName);
		await dialog.getByRole("button", { name: "저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		const root = await db
			.from("bookmark_collections")
			.select("id,name,version,parent_id")
			.eq("name", rootName)
			.single();
		expect(root.error).toBeNull();
		const rootId = root.data?.id as string;
		created.push(rootId);
		await page.getByRole("button", { name: rootName, exact: true }).click();
		await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
		dialog = page.getByRole("alertdialog");
		await expect(dialog.getByLabel("상위 컬렉션", { exact: true })).toHaveValue(rootId);
		await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(childName);
		await dialog.getByRole("button", { name: "저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		const child = await db
			.from("bookmark_collections")
			.select("id,parent_id")
			.eq("name", childName)
			.single();
		expect(child.data?.parent_id).toBe(rootId);
		created.push(child.data?.id as string);
		await expect(page.getByRole("button", { name: childName, exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: `${rootName} 하위 컬렉션 펼치기`, exact: true }).click();
		await expect(page.getByRole("button", { name: childName, exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: rootName, exact: true })).toHaveAttribute(
			"aria-current",
			"page"
		);
		await page.getByRole("button", { name: `${rootName} 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "이름 수정", exact: true }).click();
		dialog = page.getByRole("alertdialog");
		await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(renamed);
		await dialog.getByRole("button", { name: "저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(page.getByRole("button", { name: renamed, exact: true })).toBeVisible();
		await expect(
			page
				.locator('[data-sonner-toast][data-type="success"]')
				.filter({ hasText: /컬렉션 (이름을 변경|변경을 저장)했습니다\./u })
		).toHaveCount(1);
		await page.getByRole("button", { name: `${renamed} 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "컬렉션 삭제", exact: true }).click();
		dialog = page.getByRole("alertdialog");
		await expect(dialog).toContainText("북마크는 미분류로 보존");
		await dialog.getByRole("button", { name: "삭제", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await page.reload();
		await expect(page.getByRole("button", { name: renamed, exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: childName, exact: true })).toBeVisible();
		const after = await db
			.from("bookmark_collections")
			.select("id,parent_id,archived_at")
			.in("id", created);
		expect(after.error).toBeNull();
		expect(after.data?.find((c) => c.id === rootId)?.archived_at).not.toBeNull();
		expect(after.data?.find((c) => c.id !== rootId)?.parent_id).toBeNull();
		console.log(
			"MANAGER_COLLECTION_READBACK",
			JSON.stringify({ created: 2, renamed: true, rootArchived: true, childReparented: true })
		);
	} finally {
		for (const id of created.reverse()) {
			const row = await db
				.from("bookmark_collections")
				.select("id,name,version,archived_at")
				.eq("id", id)
				.single();
			if (row.data && !row.data.archived_at) await removeCollectionUI(page, row.data.name, id);
		}
	}
});
test("검토·작업 기록은 독립 화면이며 컬렉션 탐색을 표시하지 않는다", async ({ page }) => {
	for (const route of ["review", "activity"]) {
		await page.goto(`/main/bookmarks/${route}`);
		await expect(page.getByRole("navigation", { name: "북마크 보기" })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "북마크 탐색" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "컬렉션 추가", exact: true })).toHaveCount(0);
		if (route !== "activity") {
			await expect(
				page.getByRole("status").filter({ hasText: "북마크를 불러오는 중" })
			).toHaveCount(0);
			await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
			await expect(
				page.locator("main section[aria-label$=' 목록'], main .border-dashed")
			).toBeVisible();
		}
	}
});
