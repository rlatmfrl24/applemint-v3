import { expect, test } from "@playwright/test";
import { bookmarkOwner, removeCollectionUI, saveSourceBookmark } from "./support/bookmarks";

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
	await expect(page.getByText("OpenRouter 연결됨", { exact: true })).toBeVisible();
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
		await page.goto(
			`/main/bookmarks/review?type=classify&search=${encodeURIComponent(sources[0].url)}`
		);
		const name = `AI 관리자 검증 컬렉션 ${Date.now()}`;
		const first = page.locator(`[data-bookmark-id="${ids[0]}"]`);
		await first.getByRole("button", { name: "변경안", exact: true }).click();
		let dialog = page.getByRole("alertdialog");
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
		await page.goto(
			`/main/bookmarks/review?type=classify&search=${encodeURIComponent(sources[1].url)}`
		);
		const second = page.locator(`[data-bookmark-id="${ids[1]}"]`);
		await second.getByRole("button", { name: "변경안", exact: true }).click();
		dialog = page.getByRole("alertdialog");
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
