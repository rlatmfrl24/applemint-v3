import { expect, test } from "@playwright/test";
import { bookmarkOwner, removeCollectionUI, saveSourceBookmark } from "./support/bookmarks";
import { seedScheduledClassification } from "./support/database";
import { getE2ERuntime } from "./support/runtime";

test("실제 AI 관심 주제·분류를 검토 팝업에서 수정·승인하고 원본과 예산을 확인한다", async ({
	page,
}) => {
	test.skip(process.env.BOOKMARK_LIVE_AI !== "1", "실제 유료 API는 명시한 실행에서만 호출");
	test.setTimeout(480000);
	const db = await bookmarkOwner();
	const initial = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	expect(initial.error).toBeNull();
	const originalInterests = initial.data.settings.interests;
	const beforeUsed = initial.data.budget.used_nano;
	const beforeJobs = initial.data.jobs.map((job: { id: string }) => job.id);
	await page.goto("/main/setting/bookmarks");
	await expect(page.getByText("AI 설정됨", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "AI 추천 받기", exact: true }).click();
	await expect
		.poll(
			async () => {
				const result = await db
					.from("bookmark_jobs")
					.select("id,state,error")
					.eq("kind", "interests")
					.order("created_at", { ascending: false })
					.limit(1)
					.single();
				if (beforeJobs.includes(result.data?.id)) return "registering";
				if (["failed", "partial", "paused"].includes(result.data?.state))
					throw new Error(`관심 주제 작업 실패: ${result.data?.error}`);
				return result.data?.state;
			},
			{ timeout: 150000, intervals: [1000, 3000, 5000] }
		)
		.toBe("succeeded");
	const suggestions = await db
		.from("bookmark_settings")
		.select("suggested_interests,suggestions_job_id")
		.single();
	expect(suggestions.error).toBeNull();
	if (!suggestions.data) throw new Error("관심 주제 결과가 없습니다.");
	expect(suggestions.data?.suggested_interests.length).toBeGreaterThan(0);
	await expect(page.getByRole("region", { name: "AI 추천 주제", exact: true })).toBeVisible();
	const suggested = suggestions.data.suggested_interests
		.filter((topic: string) => !originalInterests.includes(topic))
		.slice(0, 2);
	const interests = [...new Set([...originalInterests, ...suggested, "프런트엔드 개발"])];
	try {
		for (const topic of suggested) {
			await page
				.getByRole("region", { name: "AI 추천 주제", exact: true })
				.getByRole("button", { name: `${topic} 추가`, exact: true })
				.click();
			await expect(page.getByRole("button", { name: `${topic} 수정`, exact: true })).toBeVisible();
		}
		if (!originalInterests.includes("프런트엔드 개발") && !suggested.includes("프런트엔드 개발")) {
			await page.getByLabel("관심 주제 이름", { exact: true }).fill("프런트엔드 개발");
			await page.getByRole("button", { name: "주제 추가", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "프런트엔드 개발 수정", exact: true })
			).toBeVisible();
		}
		expect(
			(await db.from("bookmark_settings").select("interests").single()).data?.interests
		).toEqual(interests);
		const sources = [await saveSourceBookmark(page, db), await saveSourceBookmark(page, db)];
		const ids = sources.map((item) => item.id);
		await expect
			.poll(
				async () => {
					const result = await db.from("bookmark_job_items").select("state").in("bookmark_id", ids);
					return (
						result.data?.length === 2 &&
						result.data.every((item) => ["done", "failed"].includes(item.state))
					);
				},
				{ timeout: 120000, intervals: [1000, 3000, 5000] }
			)
			.toBe(true);
		await page.goto("/main/bookmarks");
		for (const id of ids)
			await page.locator(`[data-bookmark-id="${id}"]`).getByRole("checkbox").check();
		await page.getByRole("button", { name: "AI 정리", exact: true }).click();
		await page.getByRole("menuitem", { name: "AI 컬렉션 분류", exact: true }).click();
		await expect(
			page.getByText("작업을 등록했습니다. 검토 화면에서 결과를 확인하세요.", { exact: true })
		).toBeVisible();
		await expect
			.poll(
				async () => {
					const result = await db
						.from("bookmark_jobs")
						.select("id,state,error")
						.eq("kind", "classify")
						.order("created_at", { ascending: false })
						.limit(1)
						.single();
					if (beforeJobs.includes(result.data?.id)) return "registering";
					if (["failed", "partial", "paused"].includes(result.data?.state))
						throw new Error(`분류 작업 실패: ${result.data?.error}`);
					return result.data?.state;
				},
				{ timeout: 150000, intervals: [1000, 3000, 5000] }
			)
			.toBe("succeeded");
		const proposed = await db
			.from("bookmark_proposals")
			.select("*")
			.in("bookmark_id", ids)
			.eq("state", "pending");
		expect(proposed.error).toBeNull();
		expect(proposed.data).toHaveLength(2);
		expect(proposed.data?.every((item) => item.reason.length > 0)).toBe(true);
		await page.goto("/main/bookmarks/review?group=classify");
		const name = `AI 관리자 검증 컬렉션 ${Date.now()}`;
		const first = page.locator(`[data-bookmark-id="${ids[0]}"]`);
		await first.getByRole("button", { name: "변경안", exact: true }).click();
		let dialog = page.getByRole("complementary", { name: "검토 결과", exact: true });
		await dialog.getByLabel("새 컬렉션 이름 (입력하면 새 컬렉션으로 이동)").fill(name);
		await dialog.getByRole("button", { name: "이 항목 승인·이동", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(first).toHaveCount(0);
		const created = await db
			.from("bookmark_collections")
			.select("id,name")
			.eq("name", name)
			.single();
		expect(created.error).toBeNull();
		await page.goto("/main/bookmarks/review?group=classify");
		const second = page.locator(`[data-bookmark-id="${ids[1]}"]`);
		await second.getByRole("button", { name: "변경안", exact: true }).click();
		dialog = page.getByRole("complementary", { name: "검토 결과", exact: true });
		await dialog.getByLabel("대상 컬렉션", { exact: true }).selectOption(created.data?.id);
		await expect(dialog.getByLabel("새 컬렉션 이름 (입력하면 새 컬렉션으로 이동)")).toHaveValue("");
		await dialog.getByRole("button", { name: "이 항목 승인·이동", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await page.goto("/main/bookmarks");
		await page.reload();
		for (const id of ids) await expect(page.locator(`[data-bookmark-id="${id}"]`)).toBeVisible();
		const applied = await db
			.from("bookmarks")
			.select("id,collection_id,original,source_thread_id")
			.in("id", ids);
		expect(applied.error).toBeNull();
		for (const source of sources) {
			const item = applied.data?.find((row) => row.id === source.id);
			expect(item?.collection_id).toBe(created.data?.id);
			expect(item?.original).toEqual(source.original);
			expect(item?.source_thread_id).toBe(source.source_thread_id);
		}
		const approved = await db
			.from("bookmark_proposals")
			.select("state,target_collection_id")
			.in("bookmark_id", ids);
		expect(
			approved.data?.every(
				(item) => item.state === "approved" && item.target_collection_id === created.data?.id
			)
		).toBe(true);
		const budget = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
		expect(budget.data.budget.used_nano).toBeGreaterThan(beforeUsed);
		expect(budget.data.budget.used_nano).toBeLessThanOrEqual(1000000000);
		const receipts = await db
			.from("bookmark_ai_reservations")
			.select("state,input_tokens,output_tokens,charged_nano")
			.in("job_id", [suggestions.data?.suggestions_job_id, proposed.data?.[0].job_id]);
		expect(receipts.error).toBeNull();
		expect(receipts.data).toHaveLength(2);
		expect(
			receipts.data?.every(
				(item) => item.state === "settled" && item.output_tokens > 0 && item.charged_nano > 0
			)
		).toBe(true);
		await removeCollectionUI(page, name);
		const removed = await db
			.from("bookmarks")
			.select("collection_id,previous_collection_path")
			.in("id", ids);
		expect(
			removed.data?.every(
				(item) => item.collection_id === null && item.previous_collection_path === name
			)
		).toBe(true);
		console.log(
			"LIVE_AI_MANAGER_READBACK",
			JSON.stringify({
				interestCount: suggestions.data?.suggested_interests.length,
				approved: 2,
				sourcePreserved: true,
				receipts: receipts.data,
				costNano: budget.data.budget.used_nano - beforeUsed,
				temporaryCollectionArchived: true,
			})
		);
	} finally {
		expect(
			(
				await db.rpc("bookmark_command", {
					p_action: "interests",
					p_input: { interests: originalInterests },
				})
			).error
		).toBeNull();
		expect(
			(await db.from("bookmark_settings").select("interests").single()).data?.interests
		).toEqual(originalInterests);
	}
});

test("정기 재분류는 종료 다음 날 새 후보만 처리하고 승인한 북마크만 이동한다", async ({ page }) => {
	test.skip(process.env.BOOKMARK_LIVE_AI !== "1", "실제 유료 API는 명시한 실행에서만 호출");
	test.setTimeout(300000);
	const runtime = getE2ERuntime();
	expect(["127.0.0.1", "localhost"]).toContain(new URL(runtime.baseUrl).hostname);
	const koreaNow = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
	expect(Number(koreaNow.slice(11, 13))).toBeGreaterThanOrEqual(9);
	const date = koreaNow.slice(0, 10);
	const seeded = seedScheduledClassification();
	const db = await bookmarkOwner();
	const ids = seeded.fixtures.map((item) => item.id);
	const readBookmarks = () =>
		db.from("bookmarks").select("id,collection_id,version").in("id", ids).order("id");
	const before = await readBookmarks();
	expect(before.error).toBeNull();
	expect(before.data).toHaveLength(5);
	try {
		await page.goto("/main/setting/bookmarks");
		const enabled = page.getByRole("checkbox", { name: "매일 재분류", exact: true });
		await expect(enabled).not.toBeChecked();
		await expect(page.getByRole("spinbutton", { name: "회차당 북마크 수" })).toHaveValue("100");
		await enabled.check();
		await page.getByRole("spinbutton", { name: "회차당 북마크 수" }).fill("5");
		await page.getByRole("button", { name: "정기 재분류 설정 저장" }).click();
		await expect(page.getByText("회차 재개 또는 종료 필요", { exact: true })).toBeVisible();
		await page.getByRole("link", { name: /최근 회차/ }).click();
		const preceding = page.locator(`[data-bookmark-job-id="${seeded.previousJob}"]`);
		await preceding.getByRole("button", { name: "회차 종료", exact: true }).click();
		const confirm = page.getByRole("alertdialog", { name: "이 회차를 종료할까요?" });
		await expect(confirm).toBeVisible();
		const unclosed = await db
			.from("bookmark_jobs")
			.select("state,progress")
			.eq("id", seeded.previousJob)
			.single();
		expect(unclosed.data).toMatchObject({ state: "paused", progress: { usageUncertain: true } });
		expect(unclosed.data?.progress).not.toHaveProperty("closedAt");
		await confirm.getByRole("button", { name: "종료 확인" }).click();
		await expect(preceding.getByText(/종료됨/)).toBeVisible();
		await expect(preceding.getByRole("button", { name: "같은 작업 재개" })).toHaveCount(0);
		const closed = await db
			.from("bookmark_jobs")
			.select("state,failed,progress")
			.eq("id", seeded.previousJob)
			.single();
		expect(closed.data).toMatchObject({
			state: "failed",
			failed: 1,
			progress: { closedAt: expect.any(String), usageUncertain: true },
		});
		const retained = await db
			.from("bookmark_ai_reservations")
			.select("state,reserved_nano")
			.eq("id", seeded.heldReceipt)
			.single();
		expect(retained.data).toEqual({ state: "uncertain", reserved_nano: 1000 });
		const settings = await db.rpc("bookmark_scheduled_classification_settings");
		const tomorrowAtNine = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString();
		expect(settings.data).toMatchObject({ enabled: true, dailyLimit: 5, status: "waiting" });
		expect(new Date(settings.data?.nextEligibleAt).toISOString()).toBe(tomorrowAtNine);

		seeded.advanceAfterClosure();
		const readRound = () =>
			db
				.from("bookmark_jobs")
				.select("id,state,scope,total,completed,error")
				.eq("kind", "classify")
				.eq("scope->>origin", "scheduled-classify")
				.eq("scope->>scheduledDate", date)
				.maybeSingle();
		await expect
			.poll(
				async () => {
					const { data, error } = await readRound();
					if (error) throw new Error(error.message);
					if (data && ["paused", "partial", "failed"].includes(data.state))
						throw new Error(`정기 회차 ${data.state} · ${data.error}`);
					return data?.state;
				},
				{ timeout: 150000, intervals: [1000, 3000, 5000] }
			)
			.toBe("succeeded");
		const { data: round, error: roundError } = await readRound();
		expect(roundError).toBeNull();
		expect(round).toMatchObject({
			total: 5,
			completed: 5,
			scope: { origin: "scheduled-classify", scheduledDate: date },
		});
		const items = await db
			.from("bookmark_job_items")
			.select("bookmark_id,state")
			.eq("job_id", round?.id);
		expect(items.error).toBeNull();
		expect(items.data?.map(({ bookmark_id }) => bookmark_id).sort()).toEqual([...ids].sort());
		expect(items.data?.every(({ state }) => state === "done")).toBe(true);
		expect(items.data?.map(({ bookmark_id }) => bookmark_id)).not.toContain(seeded.previousItem);
		const receipts = await db
			.from("bookmark_ai_reservations")
			.select("provider,model,state,charged_nano,reserved_nano")
			.eq("job_id", round?.id);
		expect(receipts.error).toBeNull();
		expect(receipts.data).toEqual([
			expect.objectContaining({
				provider: "openrouter",
				model: "openai/gpt-6-luna",
				state: "settled",
			}),
		]);
		expect(receipts.data?.[0].charged_nano).toBeGreaterThanOrEqual(0);

		const proposals = await db
			.from("bookmark_proposals")
			.select("bookmark_id,target_collection_id,state")
			.eq("job_id", round?.id);
		expect(proposals.error).toBeNull();
		expect(proposals.data).toHaveLength(4);
		for (const item of seeded.fixtures.filter(({ initial, target }) => initial !== target)) {
			expect(proposals.data).toContainEqual({
				bookmark_id: item.id,
				target_collection_id: item.target,
				state: "pending",
			});
		}
		expect((await readBookmarks()).data).toEqual(before.data);
		const moves = () =>
			db.from("bookmark_events").select("bookmark_id").eq("kind", "move").in("bookmark_id", ids);
		expect((await moves()).data).toEqual([]);

		await page.reload();
		await page
			.locator(`[data-bookmark-job-id="${round?.id}"]`)
			.getByRole("link", { name: "컬렉션 제안", exact: true })
			.click();
		const [approved, excluded] = seeded.fixtures;
		const row = (id: string) => page.locator(`[data-bookmark-id="${id}"]`);
		const review = page.getByRole("complementary", { name: "검토 결과", exact: true });
		await row(approved.id).getByRole("button", { name: "변경안", exact: true }).click();
		await expect(review.getByLabel("대상 컬렉션", { exact: true })).toHaveValue(approved.target);
		expect((await readBookmarks()).data).toEqual(before.data);
		await review.getByRole("button", { name: "이 항목 승인·이동", exact: true }).click();
		await expect(row(approved.id)).toHaveCount(0);
		await row(excluded.id).getByRole("button", { name: "변경안", exact: true }).click();
		await review.getByRole("button", { name: "제안 제외", exact: true }).click();
		await expect(row(excluded.id)).toHaveCount(0);
		await page.reload();
		await expect(row(approved.id)).toHaveCount(0);
		const final = await readBookmarks();
		expect(final.error).toBeNull();
		expect(final.data).toEqual(
			before.data?.map((item) =>
				item.id === approved.id
					? { ...item, collection_id: approved.target, version: item.version + 1 }
					: item
			)
		);
		expect((await moves()).data).toEqual([{ bookmark_id: approved.id }]);
		const decisions = await db
			.from("bookmark_proposals")
			.select("bookmark_id,state")
			.eq("job_id", round?.id);
		expect(decisions.data?.find(({ bookmark_id }) => bookmark_id === approved.id)?.state).toBe(
			"approved"
		);
		expect(decisions.data?.find(({ bookmark_id }) => bookmark_id === excluded.id)?.state).toBe(
			"excluded"
		);
		console.log(
			`정기 재분류 ${date} KST · 회차 ${round?.id} · 5건 완료 · 제안 4건 · 승인 이동 1건 · 제외 1건 · 비용 ${receipts.data?.[0].charged_nano} nano-USD`
		);
	} finally {
		await db.rpc("bookmark_scheduled_classification_update_settings", {
			p_enabled: false,
			p_daily_limit: 5,
		});
	}
});
