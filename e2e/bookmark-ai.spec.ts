import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getE2ERuntime } from "./support/runtime";

test("실제 AI 관심 주제·분류 제안을 수정·승인하고 DB와 예산을 확인한다", async ({ page }) => {
	test.skip(process.env.BOOKMARK_LIVE_AI !== "1", "실제 유료 API 검증은 명시한 실행에서만 수행");
	test.setTimeout(360000);
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
	const initial = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
	expect(initial.error).toBeNull();
	const originalInterests = initial.data.settings.interests as string[];
	const beforeUsed = initial.data.budget.used_nano as number;
	const beforeJobs = initial.data.jobs.map((job: { id: string }) => job.id);
	await page.goto("/main/setting/bookmarks");
	await expect(page.getByText("OPENAI_API_KEY: 설정됨", { exact: true })).toBeVisible();
	await page
		.getByRole("button", { name: "기존 컬렉션·태그로 AI 관심 주제 제안", exact: true })
		.click();
	await expect
		.poll(
			async () => {
				const jobs = await db
					.from("bookmark_jobs")
					.select("id,state,error")
					.eq("kind", "interests")
					.order("created_at", { ascending: false })
					.limit(1)
					.single();
				if (beforeJobs.includes(jobs.data?.id)) return "registering";
				if (["paused", "failed", "partial"].includes(jobs.data?.state)) {
					throw new Error(`관심 주제 작업: ${jobs.data?.state} ${jobs.data?.error}`);
				}
				return jobs.data?.state;
			},
			{ timeout: 140000, intervals: [1000, 3000, 5000] }
		)
		.toBe("succeeded");
	const suggestions = await db
		.from("bookmark_settings")
		.select("suggested_interests,suggestions_job_id")
		.single();
	expect(suggestions.error).toBeNull();
	expect(suggestions.data?.suggested_interests.length).toBeGreaterThan(0);
	assert(suggestions.data);
	expect(beforeJobs).not.toContain(suggestions.data.suggestions_job_id);
	await expect(page.getByText(/^AI 제안:/u)).toBeVisible();
	await page.getByRole("button", { name: "수정 입력에 가져오기", exact: true }).click();
	const editedInterests = [...suggestions.data.suggested_interests.slice(0, 2), "프런트엔드 개발"];
	await page.getByLabel("확정할 관심 주제 (한 줄에 하나)").fill(editedInterests.join("\n"));
	try {
		await page.getByRole("button", { name: "관심 주제 확정", exact: true }).click();
		await expect(page.getByText("관심 주제를 확정했습니다.", { exact: true })).toBeVisible();
		expect(
			(await db.from("bookmark_settings").select("interests").single()).data?.interests
		).toEqual(editedInterests);

		const stamp = Date.now();
		const samples = [
			{
				url: `https://react.dev/learn#applemint-ai-${stamp}`,
				title: `실제 AI 검증 ${stamp} React 상태 관리`,
			},
			{
				url: `https://nodejs.org/en/learn/getting-started/introduction-to-nodejs#applemint-ai-${stamp}`,
				title: `실제 AI 검증 ${stamp} Node.js 서버 개발`,
			},
		];
		await page.goto("/main/bookmarks");
		for (const sample of samples) {
			await page.getByRole("button", { name: "북마크 저장", exact: true }).click();
			const dialog = page.getByRole("alertdialog");
			await dialog.getByLabel("URL", { exact: true }).fill(sample.url);
			await dialog.getByLabel("제목 (선택)").fill(sample.title);
			await dialog.getByLabel("태그 (쉼표로 구분)").fill("개발, 실제 AI 검증");
			await dialog
				.getByLabel("메모", { exact: true })
				.fill("실제 OpenAI 분류·수정·승인 검증에서 직접 저장한 자료");
			await dialog.getByRole("button", { name: "저장", exact: true }).click();
			await expect(dialog).not.toBeVisible();
		}
		const saved = await db
			.from("bookmarks")
			.select("id,version,url")
			.in(
				"url",
				samples.map((sample) => sample.url)
			);
		expect(saved.error).toBeNull();
		expect(saved.data).toHaveLength(2);
		assert(saved.data);
		const ids = saved.data.map((item) => item.id);
		await expect
			.poll(
				async () => {
					const items = await db.from("bookmark_job_items").select("state").in("bookmark_id", ids);
					return (
						items.data?.length === 2 &&
						items.data.every((item) => ["done", "failed"].includes(item.state))
					);
				},
				{ timeout: 90000, intervals: [1000, 3000, 5000] }
			)
			.toBe(true);
		await page.getByLabel("북마크 검색").fill(`실제 AI 검증 ${stamp}`);
		await expect(page.locator("article[data-bookmark-id]")).toHaveCount(2);
		await page.getByRole("button", { name: "현재 페이지 선택", exact: true }).click();
		await page.getByLabel("작업 범위").selectOption("selected");
		await page.getByRole("button", { name: "AI 컬렉션 분류", exact: true }).click();
		await expect(
			page.getByText("작업을 등록했습니다. 브라우저를 닫아도 작업 상태가 유지됩니다.", {
				exact: true,
			})
		).toBeVisible();
		await expect
			.poll(
				async () => {
					const jobs = await db
						.from("bookmark_jobs")
						.select("id,state,error")
						.eq("kind", "classify")
						.order("created_at", { ascending: false })
						.limit(1)
						.single();
					if (beforeJobs.includes(jobs.data?.id)) return "registering";
					if (["paused", "failed", "partial"].includes(jobs.data?.state))
						throw new Error(`분류 작업: ${jobs.data?.state} ${jobs.data?.error}`);
					return jobs.data?.state;
				},
				{ timeout: 140000, intervals: [1000, 3000, 5000] }
			)
			.toBe("succeeded");
		const proposed = await db
			.from("bookmark_proposals")
			.select("*")
			.in("bookmark_id", ids)
			.eq("state", "pending");
		expect(proposed.error).toBeNull();
		expect(proposed.data).toHaveLength(2);
		assert(proposed.data);
		expect(proposed.data.every((proposal) => proposal.reason.length > 0)).toBe(true);
		const first = page.locator(`[data-bookmark-id="${ids[0]}"]`);
		const collectionName = `AI 검증 정리 ${stamp}`;
		await expect(first.getByText("AI 컬렉션 제안", { exact: true })).toBeVisible();
		await first.getByLabel("새 컬렉션 이름 (입력하면 새 컬렉션으로 이동)").fill(collectionName);
		await first.getByRole("button", { name: "이 항목 승인·이동", exact: true }).click();
		await expect(page.getByText("제안을 처리했습니다.", { exact: true })).toBeVisible();
		const created = await db
			.from("bookmark_collections")
			.select("id,name")
			.eq("name", collectionName)
			.single();
		expect(created.error).toBeNull();
		assert(created.data);
		const second = page.locator(`[data-bookmark-id="${ids[1]}"]`);
		await second.getByLabel("대상 컬렉션", { exact: true }).selectOption(created.data.id);
		await expect(second.getByLabel("새 컬렉션 이름 (입력하면 새 컬렉션으로 이동)")).toHaveValue("");
		await second.getByRole("button", { name: "이 항목 승인·이동", exact: true }).click();
		await expect(second.getByText("AI 컬렉션 제안", { exact: true })).toHaveCount(0);
		await page.reload();
		await page.getByLabel("북마크 검색").fill(`실제 AI 검증 ${stamp}`);
		await expect(page.locator("article[data-bookmark-id]")).toHaveCount(2);
		const applied = await db
			.from("bookmarks")
			.select("id,collection_id,note,source_id,original")
			.in("id", ids);
		assert(applied.data);
		expect(
			applied.data.every(
				(item) =>
					item.collection_id === created.data.id &&
					item.source_id === null &&
					item.original === null
			)
		).toBe(true);
		const approved = await db
			.from("bookmark_proposals")
			.select("state,target_collection_id")
			.in("bookmark_id", ids);
		assert(approved.data);
		expect(
			approved.data.every(
				(proposal) =>
					proposal.state === "approved" && proposal.target_collection_id === created.data.id
			)
		).toBe(true);
		const budget = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
		expect(budget.data.budget.used_nano).toBeGreaterThan(beforeUsed);
		expect(budget.data.budget.used_nano).toBeLessThanOrEqual(1000000000);
		const billing = await db
			.from("bookmark_ai_reservations")
			.select("state,input_tokens,output_tokens,reserved_nano,charged_nano")
			.in("job_id", [suggestions.data.suggestions_job_id, proposed.data[0].job_id]);
		expect(billing.error).toBeNull();
		expect(billing.data).toHaveLength(2);
		assert(billing.data);
		expect(
			billing.data.every(
				(receipt) =>
					receipt.state === "settled" && receipt.charged_nano !== null && receipt.output_tokens > 0
			)
		).toBe(true);
		console.log(
			"LIVE_AI_READBACK",
			JSON.stringify({
				interestCount: suggestions.data.suggested_interests.length,
				approvedBookmarks: 2,
				collection: collectionName,
				receipts: billing.data,
				month: budget.data.budget.month,
				usedNano: budget.data.budget.used_nano,
			})
		);
	} finally {
		// Browser timeouts must not leave temporary user policy behind.
		const restored = await db.rpc("bookmark_command", {
			p_action: "interests",
			p_input: { interests: originalInterests },
		});
		expect(restored.error).toBeNull();
		const settings = await db.from("bookmark_settings").select("interests").single();
		expect(settings.error).toBeNull();
		expect(settings.data?.interests).toEqual(originalInterests);
	}
});
