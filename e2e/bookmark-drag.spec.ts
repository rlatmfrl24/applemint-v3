import { expect, type Page, test } from "@playwright/test";
import { bookmarkOwner, removeCollectionUI } from "./support/bookmarks";

async function restoreUnfiled(page: Page, item: { id: string; title: string }) {
	await page.goto(`/main/bookmarks?search=${encodeURIComponent(item.title)}`);
	await page
		.locator(`[data-bookmark-id="${item.id}"]`)
		.getByRole("button", { name: /항목 메뉴$/u })
		.click();
	await page.getByRole("menuitem", { name: "컬렉션 이동", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("컬렉션", { exact: true }).click();
	await dialog.getByRole("treeitem", { name: "미분류", exact: true }).click();
	await dialog.getByRole("button", { name: "이동", exact: true }).click();
	await expect(dialog).not.toBeVisible();
}

test("선택한 두 북마크만 함께 드래그하고 미분류로 복구한다", async ({ page }) => {
	const db = await bookmarkOwner();
	const sample = await db
		.from("bookmarks")
		.select("*")
		.like("title", "수집 글 관리자 검증 %")
		.eq("state", "library")
		.is("collection_id", null)
		.order("saved_at", { ascending: false })
		.limit(3);
	expect(sample.error).toBeNull();
	expect(sample.data).toHaveLength(3);
	const original = sample.data ?? [];
	const selected = original.slice(0, 2);
	const target = await db
		.from("bookmark_collections")
		.select("id,name")
		.is("parent_id", null)
		.is("archived_at", null)
		.or("source_id.is.null,source_id.neq.-1")
		.order("name")
		.limit(1)
		.single();
	expect(target.error).toBeNull();
	await page.goto(`/main/bookmarks?search=${encodeURIComponent("수집 글 관리자 검증")}`);
	const navigation = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
	const row = (id: string) => page.locator(`[data-bookmark-id="${id}"]`);
	try {
		for (const item of selected) await row(item.id).getByRole("checkbox").check();
		await page.getByRole("button", { name: "선택 컬렉션 이동", exact: true }).click();
		const bulkDialog = page.getByRole("alertdialog");
		await expect(bulkDialog).toContainText("선택한 북마크 2개");
		await expect(bulkDialog.getByRole("button", { name: "이동", exact: true })).toBeDisabled();
		await bulkDialog.getByRole("button", { name: "닫기", exact: true }).click();
		await expect(row(selected[0].id)).toHaveAttribute("draggable", "true");
		await row(selected[0].id).dragTo(
			navigation.getByRole("button", { name: target.data?.name, exact: true })
		);
		await expect
			.poll(
				async () =>
					(
						await db
							.from("bookmarks")
							.select("id")
							.in(
								"id",
								selected.map((i) => i.id)
							)
							.eq("collection_id", target.data?.id)
					).data?.length
			)
			.toBe(2);
		expect(
			(await db.from("bookmarks").select("collection_id").eq("id", original[2].id).single()).data
				?.collection_id
		).toBeNull();
		for (const item of selected) {
			const moved = (await db.from("bookmarks").select("*").eq("id", item.id).single()).data;
			for (const key of ["title", "url", "note", "tags", "saved_at", "original"])
				expect(moved?.[key]).toEqual(item[key]);
			await row(item.id).getByRole("checkbox").check();
		}
		await expect(row(selected[0].id)).toHaveAttribute("draggable", "true");
		await row(selected[0].id).dragTo(
			navigation.getByRole("button", { name: "미분류", exact: true })
		);
		await expect
			.poll(
				async () =>
					(
						await db
							.from("bookmarks")
							.select("id")
							.in(
								"id",
								selected.map((i) => i.id)
							)
							.is("collection_id", null)
					).data?.length
			)
			.toBe(2);
		await page.reload();
		for (const item of selected) await expect(row(item.id)).toContainText("미분류");
	} finally {
		for (const item of selected) await restoreUnfiled(page, item);
	}
});

test("컬렉션 드래그·상위 이동·트리 팝업으로 하위 이동하고 계층을 재조회한다", async ({ page }) => {
	page.setDefaultTimeout(10000);
	const db = await bookmarkOwner();
	const prefix = `컬렉션 이동 검증 ${Date.now()}`;
	const names = [`${prefix} A`, `${prefix} B`, `${prefix} 자식`];
	const created: { id: string; name: string }[] = [];
	await page.goto("/main/bookmarks");
	try {
		for (const name of names) {
			await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
			const dialog = page.getByRole("alertdialog");
			await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(name);
			await dialog.getByRole("button", { name: "저장", exact: true }).click();
			await expect(dialog).not.toBeVisible();
			const collection = (
				await db.from("bookmark_collections").select("id,name").eq("name", name).single()
			).data;
			expect(collection).toBeTruthy();
			if (collection) created.push(collection);
		}
		const navigation = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
		const button = (name: string) => navigation.getByRole("button", { name, exact: true });
		await expect(button(names[0]).locator("..")).toHaveAttribute("draggable", "true");
		await expect(button(names[2]).locator("..")).toHaveAttribute("draggable", "true");
		await button(names[2]).dragTo(button(names[0]));
		await expect
			.poll(
				async () =>
					(
						await db
							.from("bookmark_collections")
							.select("parent_id")
							.eq("id", created[2].id)
							.single()
					).data?.parent_id
			)
			.toBe(created[0].id);
		await expect(button(names[0]).locator("..")).toHaveAttribute("draggable", "true");
		await button(names[0]).dragTo(button(names[1]));
		await expect
			.poll(
				async () =>
					(
						await db
							.from("bookmark_collections")
							.select("parent_id")
							.eq("id", created[0].id)
							.single()
					).data?.parent_id
			)
			.toBe(created[1].id);
		expect(
			(await db.from("bookmark_collections").select("parent_id").eq("id", created[2].id).single())
				.data?.parent_id
		).toBe(created[0].id);
		await expect(button(names[0]).locator("..")).toHaveAttribute("draggable", "true");
		await button(names[0]).dragTo(
			page.getByRole("region", { name: "최상위 컬렉션 이동 영역", exact: true })
		);
		await expect
			.poll(
				async () =>
					(
						await db
							.from("bookmark_collections")
							.select("parent_id")
							.eq("id", created[0].id)
							.single()
					).data?.parent_id
			)
			.toBeNull();
		await expect(button(names[2]).locator("..")).toHaveAttribute("draggable", "true");
		await button(`${names[2]} 메뉴`).click();
		await page.getByRole("menuitem", { name: "한 단계 위로", exact: true }).click();
		await expect
			.poll(
				async () =>
					(
						await db
							.from("bookmark_collections")
							.select("parent_id")
							.eq("id", created[2].id)
							.single()
					).data?.parent_id
			)
			.toBeNull();
		await expect(button(names[2]).locator("..")).toHaveAttribute("draggable", "true");
		await button(`${names[2]} 메뉴`).click();
		await page.getByRole("menuitem", { name: "컬렉션 이동", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		await dialog.getByLabel("상위 컬렉션", { exact: true }).click();
		await expect(dialog.getByRole("treeitem", { name: names[2], exact: true })).toHaveCount(0);
		await dialog.getByRole("treeitem", { name: names[1], exact: true }).click();
		await dialog.getByRole("button", { name: "이동", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await page.reload();
		expect(
			(await db.from("bookmark_collections").select("parent_id").eq("id", created[2].id).single())
				.data?.parent_id
		).toBe(created[1].id);
	} finally {
		for (const collection of created.reverse())
			await removeCollectionUI(page, collection.name, collection.id);
	}
});

test("모바일 컬렉션 이동 트리는 자기 하위 대상을 제외하고 Escape 초점을 복구한다", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/main/bookmarks");
	await page.getByRole("button", { name: "북마크 탐색", exact: true }).click();
	await page.getByRole("button", { name: "Community 메뉴", exact: true }).click();
	await page.getByRole("menuitem", { name: "컬렉션 이동", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	const trigger = dialog.getByLabel("상위 컬렉션", { exact: true });
	await trigger.click();
	const tree = dialog.getByRole("tree", { name: "컬렉션 선택", exact: true });
	await expect(tree.getByRole("treeitem", { name: "Community", exact: true })).toHaveCount(0);
	await expect(tree.getByRole("treeitem", { name: "battlepage", exact: true })).toHaveCount(0);
	await tree.getByRole("treeitem", { name: "최상위", exact: true }).press("Escape");
	await expect(tree).not.toBeVisible();
	await expect(dialog).toBeVisible();
	await expect(trigger).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await dialog.getByRole("button", { name: "취소", exact: true }).click();
});
