import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getE2ERuntime } from "./support/runtime";

test("관리자는 계층과 팝업을 제공하고 저장·설정 바로가기를 표시하지 않는다", async ({ page }) => {
	await page.goto("/main/bookmarks");
	await expect(page.getByRole("button", { name: "북마크 저장", exact: true })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "북마크 설정", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "컬렉션 추가", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toBeVisible();
	await expect(page.getByLabel("상위 컬렉션", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "취소", exact: true }).click();
	await expect(page.getByRole("button", { name: "컬렉션 추가", exact: true })).toBeFocused();
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
				.select("id,version,archived_at")
				.eq("id", id)
				.single();
			if (row.data && !row.data.archived_at)
				expect(
					(
						await db.rpc("bookmark_command", {
							p_action: "collectionRemove",
							p_input: { id, version: row.data.version },
						})
					).error
				).toBeNull();
		}
	}
});
test("검토·휴지통·작업 기록은 독립 화면이며 컬렉션 탐색을 표시하지 않는다", async ({ page }) => {
	for (const route of ["review", "trash", "activity"]) {
		await page.goto(`/main/bookmarks/${route}`);
		await expect(page.getByRole("navigation", { name: "북마크 보기" })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "북마크 컬렉션" })).toHaveCount(0);
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
