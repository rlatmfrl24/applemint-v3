import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { seedBookmarkUXSource } from "./database";
import { getE2ERuntime } from "./runtime";

export async function bookmarkOwner() {
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
	return db;
}

export async function saveSourceBookmark(
	page: Page,
	db: Awaited<ReturnType<typeof bookmarkOwner>>,
	title?: string
) {
	await page.goto("/main");
	const cards = page.getByTestId("thread-card");
	await expect(cards.first()).toBeVisible();
	for (let index = 0; index < (await cards.count()); index++) {
		const card = cards.nth(index);
		const url = await card.getAttribute("data-thread-url");
		expect(url).toBeTruthy();
		const existing = await db.rpc("bookmark_lookup", { p_url: url as string }).maybeSingle();
		expect(existing.error).toBeNull();
		if (existing.data) continue;
		const source = await db.from("threads").select("id,state").eq("url", url).single();
		expect(source.error).toBeNull();
		await card.getByRole("button", { name: "Bookmark", exact: true }).click();
		const dialog = page.getByRole("alertdialog");
		await expect(dialog.getByLabel("URL", { exact: true })).toHaveValue(url as string);
		await expect(dialog.getByLabel("URL", { exact: true })).toHaveAttribute("readonly");
		if (title !== undefined) await dialog.getByLabel("제목 (선택)").fill(title);
		await dialog.getByText("추가 정보 · 태그와 메모", { exact: true }).click();
		await dialog
			.getByLabel("메모", { exact: true })
			.fill("관리자 UI 검증: 수집 글 상태와 원본은 보존");
		await dialog.getByRole("button", { name: "저장", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		const saved = await db
			.from("bookmarks")
			.select("*")
			.eq("source_thread_id", source.data?.id)
			.single();
		expect(saved.error).toBeNull();
		expect(
			(await db.from("threads").select("state").eq("id", source.data?.id).single()).data?.state
		).toBe(source.data?.state);
		return saved.data;
	}
	const source = await seedBookmarkUXSource();
	await page.goto("/main");
	await expect(page.locator(`[data-thread-url=${JSON.stringify(source.url)}]`)).toBeVisible();
	return saveSourceBookmark(page, db, title);
}

export async function removeCollectionUI(page: Page, name: string, id?: string) {
	await page.goto(`/main/bookmarks${id ? `?collection=${id}` : ""}`);
	await page.getByRole("button", { name: `${name} 메뉴`, exact: true }).click();
	await page.getByRole("menuitem", { name: "컬렉션 삭제", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText(name);
	await dialog.getByRole("button", { name: "삭제", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await page.reload();
	await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
}
