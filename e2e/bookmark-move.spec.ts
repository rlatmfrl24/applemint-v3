import { expect, test } from "@playwright/test";
import { collectionAncestors } from "../lib/bookmark-tree";
import { bookmarkOwner } from "./support/bookmarks";

test("목록 드래그와 수정 트리로 실제 컬렉션을 이동하고 원래 소속으로 복구한다", async ({
	page,
}) => {
	const db = await bookmarkOwner();
	const sample = await db
		.from("bookmarks")
		.select("*")
		.like("title", "수집 글 관리자 검증 %")
		.eq("state", "library")
		.order("saved_at", { ascending: false })
		.limit(1)
		.single();
	expect(sample.error).toBeNull();
	const original = sample.data;
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	expect(snapshot.error).toBeNull();
	const collections = snapshot.data.collections;
	const nested = collections.find((c: { parent_id: string | null }) => c.parent_id !== null);
	expect(nested).toBeTruthy();
	const root = collections.find(
		(c: { id: string }) => c.id === collectionAncestors(nested.id, collections).at(-1)
	);
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(original.title)}`);
	const row = page.locator(`[data-bookmark-id="${original.id}"]`);
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("draggable", "true");
	try {
		await row.dragTo(
			page
				.getByRole("navigation", { name: "북마크 탐색", exact: true })
				.getByRole("button", { name: root.name, exact: true })
		);
		await expect
			.poll(
				async () =>
					(await db.from("bookmarks").select("collection_id").eq("id", original.id).single()).data
						?.collection_id
			)
			.toBe(root.id);
		await expect(row).toContainText(root.name);
		const beforeSame = (await db.from("bookmarks").select("version").eq("id", original.id).single())
			.data?.version;
		const navigation = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
		await row.dragTo(navigation.getByRole("button", { name: root.name, exact: true }));
		expect(
			(await db.from("bookmarks").select("version").eq("id", original.id).single()).data?.version
		).toBe(beforeSame);
		await row.dragTo(navigation.getByRole("button", { name: "미분류", exact: true }));
		await expect
			.poll(
				async () =>
					(await db.from("bookmarks").select("collection_id").eq("id", original.id).single()).data
						?.collection_id
			)
			.toBeNull();
		await expect(row).toContainText("미분류");
		await row.dragTo(navigation.getByRole("button", { name: root.name, exact: true }));
		await expect
			.poll(
				async () =>
					(await db.from("bookmarks").select("collection_id").eq("id", original.id).single()).data
						?.collection_id
			)
			.toBe(root.id);
		await page.reload();
		await row.getByRole("button", { name: `${original.title} 항목 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "수정", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		await dialog.getByLabel("컬렉션", { exact: true }).click();
		const tree = dialog.getByRole("tree", { name: "컬렉션 선택", exact: true });
		for (const ancestor of collectionAncestors(nested.id, collections).reverse()) {
			const item = tree.locator(`[data-collection-id="${ancestor}"]`);
			if ((await item.getAttribute("aria-expanded")) === "false") await item.press("ArrowRight");
		}
		await tree.locator(`[data-collection-id="${nested.id}"]`).click();
		await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		const moved = await db.from("bookmarks").select("*").eq("id", original.id).single();
		expect(moved.data?.collection_id).toBe(nested.id);
		for (const key of [
			"url",
			"title",
			"description",
			"note",
			"tags",
			"saved_at",
			"source_id",
			"original",
		])
			expect(moved.data?.[key]).toEqual(original[key]);
		await page.reload();
		await expect(row).toContainText(nested.name);
	} finally {
		await page.goto(`/main/bookmarks?search=${encodeURIComponent(original.title)}`);
		await row.getByRole("button", { name: `${original.title} 항목 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "컬렉션 이동", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		await dialog.getByLabel("컬렉션", { exact: true }).click();
		const tree = dialog.getByRole("tree", { name: "컬렉션 선택", exact: true });
		if (original.collection_id) {
			for (const ancestor of collectionAncestors(original.collection_id, collections).reverse()) {
				const item = tree.locator(`[data-collection-id="${ancestor}"]`);
				if ((await item.getAttribute("aria-expanded")) === "false") await item.press("ArrowRight");
			}
		}
		await tree.locator(`[data-collection-id="${original.collection_id ?? ""}"]`).click();
		await dialog.getByRole("button", { name: "이동", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		expect(
			(await db.from("bookmarks").select("collection_id").eq("id", original.id).single()).data
				?.collection_id
		).toBe(original.collection_id);
	}
});

test("모바일 이동 팝업에서 트리를 키보드로 탐색하고 Escape로 닫는다", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/main/bookmarks");
	const row = page.locator("article[data-bookmark-id]").first();
	await row.getByRole("button", { name: /항목 메뉴$/u }).click();
	await page.getByRole("menuitem", { name: "컬렉션 이동", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	const trigger = dialog.getByLabel("컬렉션", { exact: true });
	await trigger.click();
	const tree = dialog.getByRole("tree", { name: "컬렉션 선택", exact: true });
	const unfiled = tree.getByRole("treeitem", { name: "미분류", exact: true });
	await unfiled.press("Home");
	await expect(unfiled).toBeFocused();
	await unfiled.press("ArrowDown");
	await expect(tree.getByRole("treeitem").nth(1)).toBeFocused();
	await tree.getByRole("treeitem").nth(1).press("Escape");
	await expect(tree).not.toBeVisible();
	await expect(dialog).toBeVisible();
	await expect(trigger).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await dialog.getByRole("button", { name: "닫기", exact: true }).click();
});

test("드래그 시작 이후 다른 변경이 생기면 오래된 버전의 이동을 거부한다", async ({ page }) => {
	const db = await bookmarkOwner();
	const sample = await db
		.from("bookmarks")
		.select("*")
		.like("title", "수집 글 관리자 검증 %")
		.eq("state", "library")
		.order("saved_at", { ascending: false })
		.limit(1)
		.single();
	expect(sample.error).toBeNull();
	const original = { ...sample.data, note: sample.data.note.replace(/ \[동시 수정 검증\]$/u, "") };
	expect(original.collection_id).toBeNull();
	const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	const root = snapshot.data.collections.find(
		(collection: { parent_id: string | null }) => collection.parent_id === null
	);
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(original.title)}`);
	const row = page.locator(`[data-bookmark-id="${original.id}"]`);
	await expect(row).toBeVisible();
	await page.route("**/api/trpc/bookmarkCollection.move**", async (route) => {
		const changed = await db.rpc("bookmark_command", {
			p_action: "edit",
			p_input: {
				id: original.id,
				version: original.version,
				note: `${original.note} [동시 수정 검증]`,
			},
		});
		expect(changed.error).toBeNull();
		await route.continue();
	});
	try {
		const target = page
			.getByRole("navigation", { name: "북마크 탐색", exact: true })
			.getByRole("button", { name: root.name, exact: true });
		await row.dragTo(target);
		await expect(
			page.getByText("다른 화면에서 상태가 변경되었습니다. 최신 값을 확인해주세요.", {
				exact: true,
			})
		).toBeVisible();
		expect(
			(await db.from("bookmarks").select("collection_id").eq("id", original.id).single()).data
				?.collection_id
		).toBeNull();
	} finally {
		await page.unroute("**/api/trpc/bookmarkCollection.move**");
		await page.goto(`/main/bookmarks?search=${encodeURIComponent(original.title)}`);
		await row.getByRole("button", { name: `${original.title} 항목 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "수정", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		await dialog.getByRole("textbox", { name: "메모", exact: true }).fill(original.note);
		await dialog.getByLabel("컬렉션", { exact: true }).click();
		await dialog
			.getByRole("tree", { name: "컬렉션 선택", exact: true })
			.getByRole("treeitem", { name: "미분류", exact: true })
			.click();
		await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		expect(
			(await db.from("bookmarks").select("note").eq("id", original.id).single()).data?.note
		).toBe(original.note);
	}
});
