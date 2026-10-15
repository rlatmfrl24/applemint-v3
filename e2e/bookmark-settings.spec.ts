import { expect, test } from "@playwright/test";
import { bookmarkAIUsageSchema } from "../contracts/bookmark-ai-usage.schema";
import { bookmarkOwner } from "./support/bookmarks";

test("관심 주제는 즉시 표시되고 저장 실패 시 입력과 기존 주제를 보존한다", async ({ page }) => {
	await page.goto("/main/setting/bookmarks");
	const input = page.getByLabel("관심 주제 이름", { exact: true });
	await expect(input).toBeVisible();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const topic = `실패 복구 검증 ${Date.now()}`;
	await page.route("**/api/trpc/bookmarkAI.confirmInterests*", async (route) => {
		await gate;
		await route.abort();
	});
	try {
		await input.fill(topic);
		await page.getByRole("button", { name: "주제 추가", exact: true }).click();
		await expect(page.getByRole("button", { name: `${topic} 수정`, exact: true })).toBeVisible();
		release();
		await expect(page.getByRole("button", { name: `${topic} 수정`, exact: true })).toHaveCount(0);
		await expect(input).toHaveValue(topic);
	} finally {
		release();
	}
});

test("이미 등록한 추천은 후보에서 제외하고 모델별 통계는 요청할 때 펼친다", async ({ page }) => {
	await page.goto("/main/setting/bookmarks");
	await expect(page.getByRole("region", { name: "확정한 관심 주제", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: / 등록됨$/u })).toHaveCount(0);
	const table = page.getByRole("table", { name: "모델별 AI 사용량", exact: true });
	await expect(table).not.toBeVisible();
	await page.getByText("상세 사용량", { exact: true }).click();
	await expect(table).toBeVisible();
	await expect(page.getByText("AI 설정됨", { exact: true })).toBeVisible();
});

test("관심 주제를 칩으로 추가·수정·삭제하고 새로고침 후 DB와 대조한다", async ({ page }) => {
	const db = await bookmarkOwner();
	const before = await db.from("bookmark_settings").select("interests").single();
	expect(before.error).toBeNull();
	if (!before.data) throw new Error("기존 관심 주제를 읽지 못했습니다.");
	const name = `설정 UI 검증 ${Date.now()} ${"긴관심주제".repeat(18)}`;
	const renamed = `${name} 수정`;
	try {
		await page.goto("/main/setting/bookmarks");
		await expect(page.getByRole("region", { name: "확정한 관심 주제", exact: true })).toBeVisible();
		await page.getByLabel("관심 주제 이름", { exact: true }).fill(name);
		await page.getByRole("button", { name: "주제 추가", exact: true }).click();
		await expect(page.getByRole("button", { name: `${name} 수정`, exact: true })).toBeEnabled();
		await page.reload();
		await expect(page.getByRole("button", { name: `${name} 수정`, exact: true })).toBeVisible();
		await page.setViewportSize({ width: 375, height: 812 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.getByRole("button", { name: `${name} 수정`, exact: true }).click();
		await expect(page.getByLabel("관심 주제 이름", { exact: true })).toBeFocused();
		await page.getByLabel("관심 주제 이름", { exact: true }).press("Escape");
		await expect(page.getByRole("button", { name: `${name} 수정`, exact: true })).toBeFocused();
		await page.getByRole("button", { name: `${name} 수정`, exact: true }).click();
		await page.getByLabel("관심 주제 이름", { exact: true }).fill(renamed);
		await page.getByRole("button", { name: "수정 저장", exact: true }).click();
		await expect(page.getByRole("button", { name: `${renamed} 수정`, exact: true })).toBeEnabled();
		expect(
			(await db.from("bookmark_settings").select("interests").single()).data?.interests
		).toEqual([...before.data.interests, renamed]);
		await page.getByLabel("관심 주제 이름", { exact: true }).fill(renamed);
		await page.getByRole("button", { name: "주제 추가", exact: true }).click();
		await expect(page.getByText("이미 등록한 관심 주제입니다.", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: `${renamed} 삭제`, exact: true }).click();
		await expect(page.getByRole("button", { name: `${renamed} 수정`, exact: true })).toHaveCount(0);
		await expect(page.getByLabel("관심 주제 이름", { exact: true })).toBeEnabled();
		await page.reload();
		expect(
			(await db.from("bookmark_settings").select("interests").single()).data?.interests
		).toEqual(before.data?.interests);
	} finally {
		await page.goto("/main/setting/bookmarks");
		await expect(page.getByRole("region", { name: "확정한 관심 주제", exact: true })).toBeVisible();
		for (const topic of [name, renamed]) {
			const remove = page.getByRole("button", { name: `${topic} 삭제`, exact: true });
			if (await remove.count()) {
				await remove.click();
				await expect(remove).toHaveCount(0);
				await expect(page.getByLabel("관심 주제 이름", { exact: true })).toBeEnabled();
			}
		}
	}
});

test("Bklit 모델 비율과 비용이 월 전체 장부와 일치하고 테마·모바일에서 읽을 수 있다", async ({
	page,
}) => {
	const db = await bookmarkOwner();
	const usage = await db.rpc("bookmark_ai_usage");
	expect(usage.error).toBeNull();
	const summary = bookmarkAIUsageSchema.parse(usage.data);
	await page.goto("/main/setting/bookmarks");
	const table = page.getByRole("table", { name: "모델별 AI 사용량", exact: true });
	await page.getByText("상세 사용량", { exact: true }).click();
	await expect(table).toBeVisible();
	await expect(page.getByTestId("bookmark-ai-requests")).toHaveText(`${summary.requestCount}회`);
	await expect(page.getByTestId("bookmark-ai-charged")).toHaveText(
		`$${(summary.chargedNano / 1e9).toFixed(6)}`
	);
	await expect(page.getByTestId("bookmark-ai-held")).toHaveText(
		`$${(summary.heldNano / 1e9).toFixed(6)}`
	);
	await expect(
		page.getByTestId("bookmark-ai-model-chart").locator("svg path").first()
	).toBeVisible();
	expect(
		await page.getByTestId("bookmark-ai-model-chart").locator("svg path").count()
	).toBeGreaterThanOrEqual(summary.models.length);
	for (const [index, model] of summary.models.entries()) {
		const row = table.locator("tbody tr").nth(index);
		await expect(row).toContainText(`${model.requests}회`);
		await expect(row).toContainText(
			`${((model.requests / summary.requestCount) * 100).toFixed(1)}%`
		);
		await expect(row).toContainText(`$${(model.chargedNano / 1e9).toFixed(6)}`);
	}
	await expect(page.getByRole("link", { name: "북마크 관리자 열기", exact: true })).toHaveAttribute(
		"href",
		"/main/bookmarks"
	);
	for (const theme of ["Light", "Dark"]) {
		await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
		await page.getByRole("menuitem", { name: theme, exact: true }).click();
		await expect(table).toBeVisible();
	}
	await table.getByRole("button").first().focus();
	await expect(page.getByTestId("bookmark-ai-model-chart")).toContainText(
		`${summary.models[0].requests}회`
	);
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(table).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.getByRole("link", { name: "북마크 관리자 열기", exact: true }).click();
	await expect(page).toHaveURL(/\/main\/bookmarks$/u);
	await expect(page.getByRole("navigation", { name: "북마크 보기", exact: true })).toBeVisible();
});
