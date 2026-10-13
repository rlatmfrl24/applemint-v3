import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getE2ERuntime } from "./support/runtime";

test("북마크를 UI에서 저장·중복 안내·휴지통·복원하고 수집 글 상태를 유지한다", async ({ page }) => {
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
	const title = `UI 북마크 검증 ${Date.now()}`;
	const url = `https://example.com/applemint-check-${Date.now()}`;
	await page.goto("/main/bookmarks");
	await page.getByRole("button", { name: "북마크 저장", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("URL", { exact: true }).fill(url);
	await dialog.getByLabel("제목 (선택)").fill(title);
	await dialog.getByLabel("메모", { exact: true }).fill("복원 후에도 유지");
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await page.reload();
	await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
	const saved = await db.from("bookmarks").select("*").eq("url", url).single();
	expect(saved.error).toBeNull();
	expect(saved.data?.note).toBe("복원 후에도 유지");
	const row = page.locator(`[data-bookmark-id="${saved.data?.id}"]`);
	await row.getByRole("button", { name: "휴지통 이동", exact: true }).click();
	await page.getByRole("button", { name: "휴지통", exact: true }).click();
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: "복원", exact: true }).click();
	await expect(page.getByText("복원했습니다.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "라이브러리", exact: true }).click();
	await expect(row).toContainText("복원 후에도 유지");
	expect(
		(await db.from("bookmarks").select("state,note").eq("id", saved.data?.id).single()).data
	).toMatchObject({ state: "library", note: "복원 후에도 유지" });
	await page.getByRole("button", { name: "북마크 저장", exact: true }).click();
	await dialog.getByLabel("URL", { exact: true }).fill(url);
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(page.getByText("이미 저장한 URL입니다. 기존 북마크를 확인해주세요.")).toBeVisible();
	expect((await db.from("bookmarks").select("id", { count: "exact" }).eq("url", url)).count).toBe(
		1
	);
	const source = await db
		.from("threads")
		.select("id,url,state")
		.eq("state", "inbox")
		.limit(1)
		.single();
	expect(source.error).toBeNull();
	await page.goto("/main");
	const buttons = page.getByRole("button", { name: "북마크 저장", exact: true });
	await expect(buttons.first()).toBeVisible();
	await buttons.first().click();
	const sourceUrl = await dialog.getByLabel("URL", { exact: true }).inputValue();
	const before = await db.from("threads").select("id,state").eq("url", sourceUrl).single();
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const after = await db.from("threads").select("state").eq("id", before.data?.id).single();
	expect(after.data?.state).toBe(before.data?.state);
	expect(
		(await db.from("bookmarks").select("source_thread_id").eq("source_thread_id", before.data?.id))
			.data?.length
	).toBeGreaterThan(0);
});

test("실계정 Raindrop 이관을 설정 화면에서 시작하고 서버 작업·저장 진행을 확인한다", async ({
	page,
}) => {
	test.skip(
		process.env.BOOKMARK_LIVE_IMPORT !== "1",
		"실계정 이관은 지정한 로컬 검증 실행에서만 시작"
	);
	await page.goto("/main/setting/bookmarks");
	await page.getByRole("checkbox").check();
	const start = page.getByRole("button", { name: /최초 가져오기 시작|기존 이관 작업 재개/u });
	await expect(start).toBeEnabled();
	await start.click();
	await expect(page.getByText(/Raindrop 이관/u).first()).toBeVisible();
	await expect(page.getByText(/조회 .* 저장 .*페이지/u)).toBeVisible();
});

test("저장 후 실제 제목 수집과 열기 버튼 사용 기록을 확인한다", async ({ page, context }) => {
	test.setTimeout(120000);
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
	const url = `https://example.com/#applemint-metadata-${Date.now()}`;
	await page.goto("/main/bookmarks");
	await page.getByRole("button", { name: "북마크 저장", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("URL", { exact: true }).fill(url);
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await page.getByLabel("북마크 검색").fill(url);
	const row = page.locator("article[data-bookmark-id]").filter({ hasText: url });
	await expect(row.getByRole("heading", { name: "Example Domain", exact: true })).toBeVisible({
		timeout: 90000,
	});
	const saved = await db.from("bookmarks").select("id,title").eq("url", url).single();
	expect(saved.data?.title).toBe("Example Domain");
	const popup = context.waitForEvent("page");
	await row.getByRole("button", { name: "열기", exact: true }).click();
	await (await popup).close();
	await expect(row).toContainText("Applemint 열기 1회");
	const opened = await db
		.from("bookmarks")
		.select("open_count,opened_at")
		.eq("id", saved.data?.id)
		.single();
	expect(opened.data?.open_count).toBe(1);
	expect(opened.data?.opened_at).toBeTruthy();
});

test("완료된 실계정 이관은 설정 화면에서 재실행할 수 없다", async ({ page }) => {
	test.skip(
		process.env.BOOKMARK_IMPORTED_LIBRARY !== "1",
		"완료된 로컬 이관 자료에 대한 실제 대조"
	);
	await page.goto("/main/setting/bookmarks");
	await expect(page.getByText(/이관 완료 · 새 이관은 비활성화/u)).toBeVisible();
	await expect(
		page.getByRole("button", { name: /최초 가져오기 시작|기존 이관 작업 재개/u })
	).toHaveCount(0);
	await expect(page.getByText(/검증 일치/u)).toBeVisible();
	await page.goto("/main/bookmarks");
	await expect(
		page
			.getByRole("navigation", { name: "북마크 컬렉션" })
			.getByRole("button", { name: "미분류", exact: true })
	).toHaveCount(1);
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
	const imported = await db
		.from("bookmarks")
		.select("id,original")
		.not("source_id", "is", null)
		.is("collection_id", null);
	expect(imported.error).toBeNull();
	expect(imported.data?.length).toBe(4);
	await page
		.getByRole("navigation", { name: "북마크 컬렉션" })
		.getByRole("button", { name: "미분류", exact: true })
		.click();
	for (const item of imported.data ?? []) {
		expect(item.original.collection.$id).toBe(-1);
		await expect(page.locator(`[data-bookmark-id="${item.id}"]`)).toBeVisible();
	}
});

test("수동 검사에서 404를 1분 뒤 재확인하고 승인·복원한다", async ({ page }) => {
	test.setTimeout(210000);
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
	const url = `https://example.com/applemint-dead-${Date.now()}`;
	await page.goto("/main/bookmarks");
	await page.getByRole("button", { name: "북마크 저장", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("URL", { exact: true }).fill(url);
	await dialog.getByLabel("제목 (선택)").fill("수동 죽은 링크 검증");
	await dialog.getByRole("button", { name: "저장", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await page.getByLabel("북마크 검색").fill(url);
	const row = page.locator("article[data-bookmark-id]").filter({ hasText: url });
	await expect(row).toBeVisible();
	await row.getByRole("checkbox").check();
	await page.getByLabel("작업 범위").selectOption("selected");
	await page.getByRole("button", { name: "링크 검사", exact: true }).click();
	await expect(row.getByText("죽은 링크 의심", { exact: true })).toBeVisible({ timeout: 160000 });
	await expect(row).toContainText("1분 뒤 재검사");
	const saved = await db.from("bookmarks").select("id").eq("url", url).single();
	const check = await db
		.from("bookmark_checks")
		.select("status,http_status,reason")
		.eq("bookmark_id", saved.data?.id)
		.single();
	expect(check.data).toMatchObject({ status: "dead", http_status: 404 });
	expect(check.data?.reason).toContain("1분 뒤 재검사");
	await row.getByRole("button", { name: "휴지통 이동", exact: true }).click();
	await page.getByRole("button", { name: "휴지통", exact: true }).click();
	await expect(row).toBeVisible();
	expect(
		(await db.from("bookmarks").select("state").eq("id", saved.data?.id).single()).data?.state
	).toBe("trash");
	await row.getByRole("button", { name: "복원", exact: true }).click();
	await expect(page.getByText("복원했습니다.", { exact: true })).toBeVisible();
	await page.reload();
	await page.getByLabel("북마크 검색").fill(url);
	await expect(page.locator(`[data-bookmark-id="${saved.data?.id}"]`)).toBeVisible();
	expect(
		(await db.from("bookmarks").select("state").eq("id", saved.data?.id).single()).data?.state
	).toBe("library");
});
