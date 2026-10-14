import { expect, test } from "@playwright/test";
import { bookmarkOwner } from "./support/bookmarks";

test("실제 분류 요청 기록과 북마크 기준 전체 제안 제외를 UI에서 확인한다", async ({ page }) => {
	test.skip(process.env.BOOKMARK_LIVE_P2 !== "1", "소량의 실제 AI 분류는 명시한 실행에서만 호출");
	test.setTimeout(480000);
	const db = await bookmarkOwner();
	const candidates = await db
		.from("bookmarks")
		.select("*")
		.eq("state", "library")
		.not("source_thread_id", "is", null)
		.not("title", "like", "%검증%")
		.order("saved_at", { ascending: false })
		.limit(20);
	expect(candidates.error).toBeNull();
	const pending = await db.from("bookmark_proposals").select("bookmark_id").eq("state", "pending");
	expect(pending.error).toBeNull();
	const source = candidates.data?.find(
		(item) => !pending.data?.some((p) => p.bookmark_id === item.id)
	);
	if (!source) throw new Error("기존 미처리 제안이 없는 실제 수집 북마크가 필요합니다.");
	const initialUsage = await db.rpc("bookmark_ai_usage");
	expect(initialUsage.error).toBeNull();
	const jobs: string[] = [];
	try {
		await page.goto(`/main/bookmarks?search=${encodeURIComponent(source.title)}`);
		const row = page.locator(`[data-bookmark-id="${source.id}"]`);
		await row.getByRole("checkbox").check();
		for (let call = 0; call < 2; call++) {
			const before = await db.from("bookmark_jobs").select("id").eq("kind", "classify");
			expect(before.error).toBeNull();
			await page.getByRole("button", { name: "AI 정리", exact: true }).click();
			await page.getByRole("menuitem", { name: "AI 컬렉션 분류", exact: true }).click();
			let jobId = "";
			await expect
				.poll(
					async () => {
						const result = await db
							.from("bookmark_jobs")
							.select("id,state,error,scope")
							.eq("kind", "classify")
							.order("created_at", { ascending: false })
							.limit(1)
							.single();
						expect(result.error).toBeNull();
						if (before.data?.some((j) => j.id === result.data?.id)) return "registering";
						jobId = result.data?.id ?? "";
						if (["failed", "partial", "paused"].includes(result.data?.state ?? ""))
							throw new Error(`분류 실패: ${result.data?.error}`);
						return result.data?.state;
					},
					{ timeout: 150000, intervals: [500, 1000, 3000] }
				)
				.toBe("succeeded");
			jobs.push(jobId);
			const receipt = await db
				.from("bookmark_ai_reservations")
				.select("provider,model,state,charged_nano")
				.eq("job_id", jobId)
				.single();
			expect(receipt.error).toBeNull();
			expect(receipt.data).toMatchObject({
				provider: "openrouter",
				model: "openai/gpt-6-luna",
				state: "settled",
			});
			expect(receipt.data?.charged_nano).toBeGreaterThanOrEqual(0);
		}
		const generated = await db
			.from("bookmark_proposals")
			.select("id,state")
			.eq("bookmark_id", source.id)
			.eq("state", "pending");
		expect(generated.error).toBeNull();
		expect(generated.data).toHaveLength(2);
		await page.goto(`/main/bookmarks/review?search=${encodeURIComponent(source.title)}`);
		await row.getByRole("checkbox").check();
		const request = page.waitForRequest((request) =>
			request.url().includes("bookmarkProposal.excludeBookmarks")
		);
		await page.getByRole("button", { name: "선택 제안 제외", exact: true }).click();
		const body = (await request).postDataJSON();
		expect(JSON.stringify(body)).toContain(source.id);
		await expect(row).toHaveCount(0);
		const results = await db
			.from("bookmark_proposals")
			.select("state")
			.eq("bookmark_id", source.id);
		expect(results.error).toBeNull();
		expect(results.data?.every((p) => p.state === "excluded")).toBe(true);
		const after = await db.from("bookmarks").select("*").eq("id", source.id).single();
		expect(after.error).toBeNull();
		expect(after.data).toEqual(source);
		const usage = await db.rpc("bookmark_ai_usage");
		const snapshot = await db.rpc("bookmark_snapshot", { p_filter: { limit: 1 } });
		expect(usage.error).toBeNull();
		expect(snapshot.error).toBeNull();
		expect(usage.data.usedNano).toBe(snapshot.data.budget.used_nano);
		expect(usage.data.usedNano).toBeLessThanOrEqual(1000000000);
		const charges = await db
			.from("bookmark_ai_reservations")
			.select("charged_nano")
			.in("job_id", jobs);
		expect(charges.error).toBeNull();
		expect(usage.data.usedNano - initialUsage.data.usedNano).toBe(
			charges.data?.reduce((sum, r) => sum + (r.charged_nano ?? 0), 0)
		);
		await page.screenshot({ path: "reports/bookmark-p2-exclusion-ui.png" });
	} finally {
		const remaining = await db
			.from("bookmark_proposals")
			.select("id")
			.eq("bookmark_id", source.id)
			.eq("state", "pending");
		if (remaining.data?.length) {
			await page.goto(`/main/bookmarks/review?search=${encodeURIComponent(source.title)}`);
			await page.locator(`[data-bookmark-id="${source.id}"]`).getByRole("checkbox").check();
			await page.getByRole("button", { name: "선택 제안 제외", exact: true }).click();
			await expect
				.poll(
					async () =>
						(
							await db
								.from("bookmark_proposals")
								.select("id")
								.eq("bookmark_id", source.id)
								.eq("state", "pending")
						).data?.length
				)
				.toBe(0);
		}
	}
});
