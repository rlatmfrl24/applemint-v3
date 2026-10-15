import { expect, type Page, type Route, test } from "@playwright/test";
import {
	bookmarkJobSchema,
	bookmarkRecommendationSchema,
	bookmarkSaveInputSchema,
} from "../contracts/bookmark.schema";
import { collectionPath } from "../lib/bookmark-collection";
import { collectionForHost } from "../lib/bookmark-host";
import { bookmarkOwner } from "./support/bookmarks";
import { seedBookmarkUXSource } from "./support/database";

async function findUnmatchedSource(page: Page, db: Awaited<ReturnType<typeof bookmarkOwner>>) {
	const active = await db.from("bookmark_collections").select("*").is("archived_at", null);
	expect(active.error).toBeNull();
	const cards = page.getByTestId("thread-card");
	await expect(cards.first()).toBeVisible();
	for (let index = 0; index < (await cards.count()); index++) {
		const candidate = await cards.nth(index).getAttribute("data-thread-url");
		if (!candidate || collectionForHost(candidate, active.data ?? [])) continue;
		const existing = await db.from("bookmarks").select("id").eq("url", candidate);
		expect(existing.error).toBeNull();
		if (!existing.data?.length) return candidate;
	}
	const seeded = await seedBookmarkUXSource();
	await page.goto("/main");
	await expect(page.locator(`[data-thread-url=${JSON.stringify(seeded.url)}]`)).toBeVisible();
	return seeded.url;
}

test("호스트와 일치하는 컬렉션은 팝업에서 바로 선택되고 추천 클릭에도 유료 작업을 만들지 않는다", async ({
	page,
}) => {
	const db = await bookmarkOwner();
	const before = await db.rpc("bookmark_ai_usage");
	expect(before.error).toBeNull();
	await page.goto("/main");
	const card = page.locator('[data-thread-url^="https://www.fmkorea.com/"]').first();
	await expect(card).toBeVisible();
	await card.getByRole("button", { name: "북마크 저장", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.getByLabel("컬렉션", { exact: true })).toContainText("fmkorea");
	await dialog.getByRole("button", { name: /다시 추천|요청 다시 확인/u }).click();
	await expect(dialog.getByLabel("컬렉션", { exact: true })).toContainText("fmkorea");
	await expect(dialog.getByRole("region", { name: "컬렉션 추천", exact: true })).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: "추천 적용", exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "취소", exact: true }).click();
	const after = await db.rpc("bookmark_ai_usage");
	expect(after.data).toEqual(before.data);
});

test("작업 기록의 추천 조회 실패는 조회만 재시도하고 실제 결과를 자동 적용한다", async ({
	page,
}) => {
	const db = await bookmarkOwner();
	const completed = await db
		.from("bookmark_jobs")
		.select("*")
		.eq("kind", "recommend")
		.eq("state", "succeeded")
		.order("created_at", { ascending: false })
		.limit(1)
		.single();
	expect(completed.error).toBeNull();
	const job = bookmarkJobSchema.parse(completed.data);
	const result = bookmarkRecommendationSchema.parse(job.progress.recommendation);
	const collections = await db.from("bookmark_collections").select("*").is("archived_at", null);
	const before = await db.rpc("bookmark_ai_usage");
	let reads = 0;
	let registrations = 0;
	await page.route("**/api/trpc/**", async (route) => {
		const url = route.request().url();
		if (url.includes("bookmarkAI.recommendation")) {
			reads++;
			if (reads === 1) return route.abort();
		} else if (url.includes("bookmarkAI.recommend")) {
			registrations++;
			return route.abort();
		}
		await route.continue();
	});
	await page.goto("/main/bookmarks/activity");
	await page
		.locator(`[data-bookmark-job-id="${job.id}"]`)
		.getByRole("button", { name: "추천 확인·저장", exact: true })
		.click();
	const dialog = page.getByRole("alertdialog");
	await expect(
		dialog.getByRole("button", { name: "추천 결과 다시 확인", exact: true })
	).toBeVisible();
	await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
	await dialog.getByRole("button", { name: "추천 결과 다시 확인", exact: true }).click();
	await expect(dialog.getByText("AI 추천", { exact: true })).toBeVisible();
	await expect(dialog.getByLabel("컬렉션", { exact: true })).toHaveText(
		collectionPath(result.collectionId, collections.data ?? [])
	);
	await expect(dialog.getByRole("region", { name: "컬렉션 추천", exact: true })).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: "추천 적용", exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "취소", exact: true }).click();
	await page
		.locator(`[data-bookmark-job-id="${job.id}"]`)
		.getByRole("button", { name: "추천 확인·저장", exact: true })
		.click();
	await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
	await expect(dialog.getByLabel("컬렉션", { exact: true })).toHaveText(
		collectionPath(result.collectionId, collections.data ?? [])
	);
	await dialog.getByRole("button", { name: "취소", exact: true }).click();
	expect(registrations).toBe(0);
	expect(reads).toBeGreaterThanOrEqual(2);
	expect((await db.rpc("bookmark_ai_usage")).data).toEqual(before.data);
});

test("컬렉션 조회가 실패한 뒤 늦게 복구돼도 호스트 추천은 유료 요청을 보내지 않는다", async ({
	page,
}) => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let paidRequests = 0;
	let firstCollection = true;
	await page.route("**/api/trpc/**", async (route) => {
		const url = route.request().url();
		if (url.includes("bookmarkAI.recommend") && !url.includes("bookmarkAI.recommendation")) {
			paidRequests++;
			return route.abort();
		}
		if (!url.includes("bookmarkCollection.list")) return route.continue();
		const response = await route.fetch();
		if (firstCollection) {
			firstCollection = false;
			const paths = new URL(url).pathname.split("/").pop()?.split(",") ?? [];
			const body = await response.json();
			body[paths.indexOf("bookmarkCollection.list")] = {
				error: {
					message: "컬렉션 일시 조회 실패",
					code: -32603,
					data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "bookmarkCollection.list" },
				},
			};
			return route.fulfill({ response, json: body });
		}
		await gate;
		await route.fulfill({ response });
	});
	try {
		await page.goto("/main");
		await page
			.locator('[data-thread-url^="https://www.fmkorea.com/"]')
			.first()
			.getByRole("button", { name: "북마크 저장", exact: true })
			.click();
		const dialog = page.getByRole("alertdialog");
		release();
		await expect(dialog.getByLabel("컬렉션", { exact: true })).toContainText("fmkorea");
		expect(paidRequests).toBe(0);
		await dialog.getByRole("button", { name: "취소", exact: true }).click();
	} finally {
		release();
	}
});

test("Main 저장 팝업은 자동 추천 뒤 컬렉션 트리의 수동 선택을 제공한다", async ({ page }) => {
	await page.goto("/main");
	const card = page.getByTestId("thread-card").first();
	await expect(card).toBeVisible();
	await card.getByRole("button", { name: "북마크 저장", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.getByLabel("제목 (선택)")).toBeFocused();
	await expect(dialog.getByRole("button", { name: /다시 추천|요청 다시 확인/u })).toBeVisible();
	await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled({
		timeout: 90000,
	});
	await dialog.getByLabel("컬렉션", { exact: true }).click();
	const tree = dialog.getByRole("tree", { name: "컬렉션 선택", exact: true });
	await expect(tree).toBeVisible();
	await tree.getByRole("treeitem", { name: "study", exact: true }).click();
	await expect(dialog.getByLabel("컬렉션", { exact: true })).toContainText("study");
	await dialog.getByRole("button", { name: "취소", exact: true }).click();
	await expect(card.getByRole("button", { name: "북마크 저장", exact: true })).toBeFocused();
});

test("실제 추천 결과가 늦게 도착해도 그 사이 바꾼 제목에 적용하지 않는다", async ({ page }) => {
	const db = await bookmarkOwner();
	const before = await db.rpc("bookmark_ai_usage");
	const completed = await db
		.from("bookmark_jobs")
		.select("*")
		.eq("kind", "recommend")
		.eq("state", "succeeded")
		.order("created_at", { ascending: false })
		.limit(2);
	expect(completed.error).toBeNull();
	const job = bookmarkJobSchema.parse(completed.data?.[0]);
	const previousJob = bookmarkJobSchema.parse(completed.data?.[1]);
	let release = () => {};
	let deferred = false;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.goto("/main/bookmarks/activity");
	await page
		.locator(`[data-bookmark-job-id="${previousJob.id}"]`)
		.getByRole("button", { name: "추천 확인·저장", exact: true })
		.click();
	const preload = page.getByRole("alertdialog");
	await expect(preload.getByText("AI 추천", { exact: true })).toBeVisible();
	await preload.getByLabel("컬렉션", { exact: true }).click();
	await expect(preload.getByRole("treeitem", { name: "study", exact: true })).toBeVisible();
	await preload.getByRole("treeitem", { name: "study", exact: true }).press("Escape");
	await preload.getByRole("button", { name: "취소", exact: true }).click();
	await page.route("**/api/trpc/**", async (route) => {
		if (!route.request().url().includes("bookmarkAI.recommendation")) return route.continue();
		const response = await route.fetch();
		deferred = true;
		await gate;
		await route.fulfill({ response });
	});
	try {
		await page
			.locator(`[data-bookmark-job-id="${job.id}"]`)
			.getByRole("button", { name: "추천 확인·저장", exact: true })
			.click();
		const dialog = page.getByRole("alertdialog");
		await expect.poll(() => deferred).toBe(true);
		const prior = await dialog.getByLabel("컬렉션", { exact: true }).innerText();
		await dialog.getByLabel("제목 (선택)").fill(`${job.scope.title} 수정`);
		release();
		await expect(
			page.getByText(
				"입력을 변경해 이전 추천을 적용하지 않았습니다. 필요하면 다시 추천받아주세요.",
				{ exact: true }
			)
		).toBeVisible();
		await expect(dialog.getByLabel("컬렉션", { exact: true })).toHaveText(prior);
		await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
		await dialog.getByRole("button", { name: "취소", exact: true }).click();
		expect((await db.rpc("bookmark_ai_usage")).data).toEqual(before.data);
	} finally {
		release();
	}
});

async function restoreQuickSource(db: Awaited<ReturnType<typeof bookmarkOwner>>, id: number) {
	const original = await db.from("threads").select("state").eq("id", id).single();
	expect(original.error).toBeNull();
	if (original.data?.state === "inbox") return;
	expect(original.data?.state).toBe("saved");
	for (const [from, to] of [
		["saved", "trash"],
		["trash", "inbox"],
	]) {
		expect(
			(
				await db.rpc("transition_thread_state", {
					p_thread_id: id,
					p_expected_state: from,
					p_destination_state: to,
				})
			).error
		).toBeNull();
	}
}

test("저장 처리가 시작되면 이미 열린 컬렉션 트리도 선택할 수 없다", async ({ page }) => {
	await page.goto("/main");
	const card = page.getByTestId("thread-card").first();
	await card.getByRole("button", { name: "북마크 저장", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await dialog.getByLabel("컬렉션", { exact: true }).click();
	const tree = dialog.getByRole("tree", { name: "컬렉션 선택", exact: true });
	await expect(tree).toBeVisible();
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/trpc/bookmark.save**", async (route) => {
		const response = await route.fetch();
		await gate;
		await route.fulfill({ response });
	});
	try {
		await dialog.getByRole("button", { name: "저장", exact: true }).click();
		await expect(dialog.getByLabel("컬렉션", { exact: true })).toBeDisabled();
		await expect(tree).not.toBeVisible();
	} finally {
		release();
	}
	await expect(dialog).not.toBeVisible();
});

test("Quick에서도 같은 트리 팝업을 사용하고 취소 시 수집 글을 보존한다", async ({ page }) => {
	const db = await bookmarkOwner();
	await page.goto("/main");
	const first = page.getByTestId("thread-card").first();
	await expect(first).toBeVisible();
	const url = await first.getAttribute("data-thread-url");
	const card = page.locator(`[data-thread-url=${JSON.stringify(url)}]`);
	const source = await db.from("threads").select("id").eq("url", url).single();
	expect(source.error).toBeNull();
	if (!source.data) throw new Error("수집 글이 없습니다.");
	try {
		await card.getByRole("button", { name: "Quick Save", exact: true }).click();
		await expect(card).toHaveCount(0);
		await page.goto("/main/quick");
		await page
			.locator(`[data-thread-url=${JSON.stringify(url)}]`)
			.getByRole("button", { name: "북마크 저장", exact: true })
			.click();
		const dialog = page.getByRole("alertdialog");
		await expect(dialog.getByRole("button", { name: /다시 추천|요청 다시 확인/u })).toBeVisible();
		await dialog.getByLabel("컬렉션", { exact: true }).click();
		await dialog.getByRole("treeitem", { name: "study", exact: true }).click();
		await dialog.getByRole("button", { name: "취소", exact: true }).click();
		expect(
			(await db.from("threads").select("state").eq("id", source.data?.id).single()).data?.state
		).toBe("saved");
	} finally {
		await restoreQuickSource(db, source.data.id);
	}
});

for (const screen of ["Main", "Quick"]) {
	test(`${screen}: 실제 Jev 추천이 트리에 자동 선택되고 저장 및 합산 예산을 재조회한다`, async ({
		page,
	}) => {
		test.skip(process.env.BOOKMARK_LIVE_JEV !== "1", "실제 Jev 호출은 명시한 로컬 실행에서만 수행");
		test.setTimeout(180000);
		const db = await bookmarkOwner();
		const before = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
		expect(before.error).toBeNull();
		await page.goto("/main");
		const url = await findUnmatchedSource(page, db);
		const source = await db.from("threads").select("id,state").eq("url", url).single();
		expect(source.error).toBeNull();
		if (!source.data) throw new Error("수집 글이 없습니다.");
		const card = page.locator(`[data-thread-url=${JSON.stringify(url)}]`);
		if (screen === "Quick") {
			await card.getByRole("button", { name: "Quick Save", exact: true }).click();
			await expect(card).toHaveCount(0);
			await page.goto("/main/quick");
		}
		try {
			const started = new Date().toISOString();
			await card.getByRole("button", { name: "북마크 저장", exact: true }).click();
			const dialog = page.getByRole("alertdialog");
			const title = await dialog.getByLabel("제목 (선택)").inputValue();

			let jobId = "";
			await expect
				.poll(
					async () => {
						const response = await db
							.from("bookmark_jobs")
							.select("*")
							.eq("kind", "recommend")
							.eq("scope->>threadId", String(source.data?.id))
							.gte("created_at", started)
							.order("created_at", { ascending: false })
							.limit(1)
							.maybeSingle();
						expect(response.error).toBeNull();
						if (!response.data) return "registering";
						const job = bookmarkJobSchema.parse(response.data);
						jobId = job.id;
						if (["failed", "paused", "partial"].includes(job.state))
							throw new Error(job.error ?? "Jev 추천 실패");
						return job.state;
					},
					{ timeout: 90000, intervals: [1000, 2000, 5000] }
				)
				.toBe("succeeded");
			expect((await db.from("bookmarks").select("id").eq("url", url)).data).toHaveLength(0);
			const finished = await db.from("bookmark_jobs").select("*").eq("id", jobId).single();
			const job = bookmarkJobSchema.parse(finished.data);
			const recommendation = bookmarkRecommendationSchema.parse(job.progress.recommendation);
			expect(recommendation.model).toBe("typesafe/jev-1.13-20260917");
			await expect(dialog.getByRole("region", { name: "컬렉션 추천", exact: true })).toHaveCount(0);
			await expect(dialog.getByRole("button", { name: "추천 적용", exact: true })).toHaveCount(0);
			await expect(dialog.getByRole("button", { name: /다시 추천|요청 다시 확인/u })).toBeEnabled();
			const collections =
				(await db.from("bookmark_collections").select("*").is("archived_at", null)).data ?? [];
			await expect(dialog.getByLabel("컬렉션", { exact: true })).toHaveText(
				collectionPath(recommendation.collectionId, collections)
			);
			await dialog.getByLabel("컬렉션", { exact: true }).click();
			const tree = dialog.getByRole("tree", { name: "컬렉션 선택", exact: true });
			const selected = tree.locator('[aria-selected="true"]');
			await expect(selected).toHaveAttribute(
				"data-collection-id",
				recommendation.collectionId ?? ""
			);
			let finalId = recommendation.collectionId;
			if (screen === "Quick") {
				const override = collections.find(
					(c) => c.parent_id === null && c.source_id !== "-1" && c.id !== finalId
				);
				if (!override) throw new Error("수정할 기존 컬렉션이 없습니다.");
				await tree.getByRole("treeitem", { name: override.name, exact: true }).click();
				finalId = override.id;
			} else {
				await selected.press("Escape");
			}
			await page.screenshot({ path: `reports/bookmark-jev-${screen.toLowerCase()}.png` });
			const submitted = page.waitForRequest(
				(request) => request.method() === "POST" && request.url().includes("bookmark.save")
			);
			await dialog.getByRole("button", { name: "저장", exact: true }).click();
			const payload = (await submitted).postDataJSON();
			const input = bookmarkSaveInputSchema.parse(Object.values(payload)[0]);
			expect(input.recommendationId).toBe(screen === "Main" ? jobId : undefined);
			await expect(dialog).not.toBeVisible();
			const saved = await db
				.from("bookmarks")
				.select("id,url,title,collection_id,source_thread_id")
				.eq("url", url)
				.single();
			expect(saved.error).toBeNull();
			expect(saved.data).toMatchObject({
				url,
				title,
				collection_id: finalId,
				source_thread_id: source.data?.id,
			});
			expect(
				(await db.from("threads").select("state").eq("id", source.data?.id).single()).data?.state
			).toBe(screen === "Quick" ? "saved" : "inbox");
			const receipt = await db
				.from("bookmark_ai_reservations")
				.select("state,reserved_nano,charged_nano,input_tokens,output_tokens,provider,model")
				.eq("job_id", jobId)
				.single();
			expect(receipt.error).toBeNull();
			expect(receipt.data).toMatchObject({ provider: "openrouter", model: "typesafe/jev-1.13" });
			expect(receipt.data?.state).toBe("settled");
			expect(receipt.data?.charged_nano).toBeGreaterThan(0);
			expect(receipt.data?.charged_nano).toBeLessThanOrEqual(receipt.data?.reserved_nano);
			const after = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
			expect(after.error).toBeNull();
			expect(after.data.budget.used_nano).toBeLessThanOrEqual(1000000000);
			expect(after.data.budget.used_nano - before.data.budget.used_nano).toBe(
				receipt.data?.charged_nano
			);
			await page.goto(`/main/bookmarks?search=${encodeURIComponent(url)}`);
			await expect(page.locator(`[data-bookmark-id="${saved.data?.id}"]`)).toBeVisible();
			console.log(
				"JEV_SAVE_READBACK",
				JSON.stringify({
					screen,
					jobId,
					bookmarkId: saved.data?.id,
					recommendation: recommendation.collectionId,
					finalCollection: finalId,
					receipt: receipt.data,
					monthlyUsedNano: after.data.budget.used_nano,
				})
			);
		} finally {
			if (screen === "Quick") await restoreQuickSource(db, source.data.id);
		}
	});
}

async function missingAIConfiguration(route: Route) {
	const response = await route.fetch();
	const body = await response.json();
	for (const entry of Array.isArray(body) ? body : [body])
		if (typeof entry.result?.data?.openrouter === "boolean") entry.result.data.openrouter = false;
	await route.fulfill({ response, json: body });
}

for (const failure of ["missing-key", "budget"] as const) {
	test(`자동 추천 ${failure} 오류는 이유와 수동 저장 경로를 제공한다`, async ({ page }) => {
		const db = await bookmarkOwner();
		await page.goto("/main");
		const url = await findUnmatchedSource(page, db);
		const before = await db.rpc("bookmark_ai_usage");
		let registrations = 0;
		await page.route("**/api/trpc/**", async (route) => {
			const request = route.request().url();
			if (request.includes("bookmarkAI.recommend?") || request.includes("bookmarkAI.recommend&")) {
				registrations++;
				await route.fulfill({
					status: 403,
					contentType: "application/json",
					body: JSON.stringify([
						{
							error: {
								message: "북마크 AI 월 예산이 부족합니다.",
								code: -32003,
								data: { code: "FORBIDDEN", httpStatus: 403, path: "bookmarkAI.recommend" },
							},
						},
					]),
				});
				return;
			}
			if (failure === "missing-key" && request.includes("bookmarkImport.configuration")) {
				await missingAIConfiguration(route);
				return;
			}
			await route.continue();
		});
		await page
			.locator(`[data-thread-url=${JSON.stringify(url)}]`)
			.getByRole("button", { name: "북마크 저장", exact: true })
			.click();
		const dialog = page.getByRole("alertdialog");
		await expect(
			dialog.getByText(
				failure === "missing-key"
					? "AI 설정이 없어 수동으로 저장할 수 있습니다."
					: "북마크 AI 월 예산이 부족합니다.",
				{ exact: true }
			)
		).toBeVisible();
		await expect(dialog.getByLabel("컬렉션", { exact: true })).toBeEnabled();
		await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
		expect(registrations).toBe(failure === "missing-key" ? 0 : 1);
		await dialog.getByRole("button", { name: "취소", exact: true }).click();
		expect((await db.rpc("bookmark_ai_usage")).data).toEqual(before.data);
	});
}
