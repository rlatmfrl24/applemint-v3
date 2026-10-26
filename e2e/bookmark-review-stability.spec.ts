import { expect, test } from "@playwright/test";
import { bookmarkOwner } from "./support/bookmarks";
import { seedBookmarkReviewStability } from "./support/database";

test.describe("북마크 검토 실제 조회와 정리", () => {
	let fixture: ReturnType<typeof seedBookmarkReviewStability>;
	test.beforeAll(() => {
		fixture = seedBookmarkReviewStability();
	});
	test.afterAll(() => fixture?.cleanup());

	test("여러 범위를 본 뒤 유지해도 현재 목록만 재조회하고 다시 불러올 수 있다", async ({
		page,
	}) => {
		const db = await bookmarkOwner();
		await page.goto("/main/bookmarks/review");
		const scope = page.getByRole("combobox", { name: "검토 범위" });
		const refresh = page.getByRole("button", { name: "목록 새로고침", exact: true });
		await expect(refresh).toBeEnabled();
		for (const group of ["attention", "organize", "problems"]) {
			await scope.selectOption(group);
			await expect(refresh).toBeEnabled();
		}
		const row = page.locator(`[data-bookmark-id="${fixture.ids[4]}"]`);
		await expect(row).toBeVisible();
		await row.getByRole("button", { name: / 상세 보기$/u }).click();
		await page
			.getByRole("complementary", { name: "북마크 상세", exact: true })
			.getByRole("button", { name: "닫기", exact: true })
			.click();
		const reads: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("/api/trpc/bookmark.list")) reads.push(request.url());
		});
		await page.route("**/api/trpc/bookmark.list*", (route) => {
			const input = new URL(route.request().url()).searchParams.get("input") ?? "";
			return input.includes('"reviewGroup":"attention"') ? route.abort() : route.continue();
		});
		const reloaded = page.waitForResponse(
			(response) => response.url().includes("/api/trpc/bookmark.list") && response.ok()
		);
		await row.getByRole("button", { name: "유지", exact: true }).click();
		await reloaded;
		await expect(row).toHaveCount(0);
		await expect(refresh).toBeEnabled();
		expect(reads).toHaveLength(1);
		expect(new URL(reads[0]).searchParams.get("input")).toContain('"reviewGroup":"problems"');
		await expect(
			page.getByText("변경은 저장되었습니다. 최신 목록을 다시 확인해주세요.")
		).toHaveCount(0);
		expect(
			(
				await db
					.from("bookmark_checks")
					.select("reviewed_at")
					.eq("bookmark_id", fixture.ids[4])
					.single()
			).data?.reviewed_at
		).not.toBeNull();
		await page.unroute("**/api/trpc/bookmark.list*");
		await refresh.click();
		await expect(refresh).toBeEnabled();
		await expect(row).toHaveCount(0);
		await page.reload();
		await expect(refresh).toBeEnabled();
		await expect(row).toHaveCount(0);
	});

	test("상단 정리와 세 화면 너비에서 검토 범위를 사용할 수 있다", async ({ page }) => {
		for (const width of [375, 972, 1440]) {
			await page.setViewportSize({ width, height: 998 });
			await page.goto("/main/bookmarks/review?search=hidden");
			await expect(page.getByRole("combobox", { name: "검토 범위" })).toHaveValue("problems");
			await expect(page.locator(`[data-bookmark-id="${fixture.ids[0]}"]`)).toBeVisible();
			await expect(page.getByLabel("북마크 검색")).toHaveCount(0);
			await expect(page.getByRole("button", { name: "근거", exact: true })).toHaveCount(0);
			await expect(page.getByRole("link", { name: "작업 기록", exact: true })).toHaveCount(0);
			await expect(page.getByText("저장 · 검토 · 정리")).toHaveCount(0);
			expect(page.url()).not.toContain("search=");
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
			await page.screenshot({ path: `reports/bookmark-review-stability/review-${width}.png` });
		}
		await page.goto("/main/bookmarks");
		await expect(page.getByLabel("북마크 검색")).toBeVisible();
		await expect(page.getByLabel("컬렉션 검색", { exact: true })).toHaveCount(0);
		await page.screenshot({ path: "reports/bookmark-review-stability/library-1440.png" });
	});

	test("게시 중 다중 페이지·선택·스크롤을 보존하고 첫 페이지만 명시적으로 반영한다", async ({
		page,
	}) => {
		test.setTimeout(90000);
		const db = await bookmarkOwner();
		const reads: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("/api/trpc/") && request.url().includes("bookmark.list"))
				reads.push(request.url());
		});
		await page.goto("/main/bookmarks/review");
		const first = page.locator(`[data-bookmark-id="${fixture.ids[0]}"]`);
		await first.getByRole("checkbox").check();
		await page.getByTestId("bookmark-load-more-sentinel").scrollIntoViewIfNeeded();
		await expect(page.locator("article[data-bookmark-id]")).not.toHaveCount(100);
		const scroll = page.locator("[data-bookmark-scroll]");
		const position = await scroll.evaluate((element) => element.scrollTop);
		const loaded = await page.locator("article[data-bookmark-id]").count();
		const before = reads.length;
		fixture.publish();
		await expect(page.getByRole("button", { name: "새 결과 보기", exact: true })).toBeVisible({
			timeout: 25000,
		});
		expect(reads).toHaveLength(before);
		await expect(first.getByRole("checkbox")).toBeChecked();
		expect(await page.locator("article[data-bookmark-id]").count()).toBe(loaded);
		expect(await scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(position, 0);
		await page.route("**/api/trpc/bookmark.list*", (route) => route.abort());
		await page.getByRole("button", { name: "새 결과 보기", exact: true }).click();
		await expect(
			page.getByText("최신 목록을 불러오지 못했습니다. 기존 목록은 유지됩니다.")
		).toBeVisible();
		await expect(first.getByRole("checkbox")).toBeChecked();
		expect(await page.locator("article[data-bookmark-id]").count()).toBe(loaded);
		expect(await scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(position, 0);
		await page.unroute("**/api/trpc/bookmark.list*");
		const beforeApply = reads.length;
		await page.getByRole("button", { name: "새 결과 보기", exact: true }).click();
		await expect(page.locator("article[data-bookmark-id]")).toHaveCount(100);
		await expect(first.getByRole("checkbox")).not.toBeChecked();
		expect(reads).toHaveLength(beforeApply + 1);
		expect(await scroll.evaluate((element) => element.scrollTop)).toBe(0);
		await expect(page.getByRole("button", { name: "새 결과 보기", exact: true })).toHaveCount(0);
		const beforeOpen = reads.length;
		const popup = page.waitForEvent("popup");
		await first.getByRole("link").click();
		await (await popup).close();
		await expect
			.poll(
				async () =>
					(await db.from("bookmarks").select("open_count").eq("id", fixture.ids[0]).single()).data
						?.open_count
			)
			.toBe(1);
		expect(reads).toHaveLength(beforeOpen);
		await expect(first).toContainText("열기 1회");
	});

	test("제목 상세·유지·삭제 실행 취소·컬렉션 승인이 DB에 반영된다", async ({ page }) => {
		const db = await bookmarkOwner();
		const budget = await db.rpc("bookmark_ai_usage");
		await page.goto("/main/bookmarks/review");
		const kept = page.locator(`[data-bookmark-id="${fixture.ids[1]}"]`);
		await kept.getByRole("button", { name: / 상세 보기$/u }).click();
		const panel = page.getByRole("complementary", { name: "북마크 상세", exact: true });
		await expect(panel.getByRole("region", { name: "북마크 검사 근거" })).toContainText("HTTP 404");
		await panel.getByRole("button", { name: "닫기", exact: true }).click();
		await kept.getByRole("button", { name: "유지", exact: true }).click();
		await expect(kept).toHaveCount(0);
		await expect
			.poll(
				async () =>
					(
						await db
							.from("bookmark_checks")
							.select("reviewed_at")
							.eq("bookmark_id", fixture.ids[1])
							.single()
					).data?.reviewed_at
			)
			.not.toBeNull();
		expect(
			(await db.from("bookmarks").select("state").eq("id", fixture.ids[1]).single()).data?.state
		).toBe("library");
		const deleted = page.locator(`[data-bookmark-id="${fixture.ids[2]}"]`);
		await deleted.getByRole("button", { name: "삭제", exact: true }).click();
		await expect(deleted).toHaveCount(0);
		await expect
			.poll(
				async () =>
					(await db.from("bookmarks").select("state").eq("id", fixture.ids[2]).single()).data?.state
			)
			.toBe("trash");
		await page.getByRole("button", { name: "실행 취소", exact: true }).click();
		await expect
			.poll(
				async () =>
					(await db.from("bookmarks").select("state").eq("id", fixture.ids[2]).single()).data?.state
			)
			.toBe("library");
		await page.getByRole("combobox", { name: "검토 범위" }).selectOption("classify");
		await page
			.locator(`[data-bookmark-id="${fixture.ids[5]}"]`)
			.getByRole("button", { name: "변경안", exact: true })
			.click();
		const proposal = page.getByRole("complementary", { name: "검토 결과", exact: true });
		const collections = await db.rpc("bookmark_collections_snapshot");
		const target = collections.data[0].id;
		await proposal.getByLabel("대상 컬렉션", { exact: true }).selectOption(target);
		await proposal.getByRole("button", { name: "이 항목 승인·이동", exact: true }).click();
		await expect(proposal).not.toBeVisible();
		expect(
			(await db.from("bookmarks").select("collection_id").eq("id", fixture.ids[5]).single()).data
				?.collection_id
		).toBe(target);
		expect((await db.rpc("bookmark_ai_usage")).data.usedNano).toBe(budget.data.usedNano);
	});
});
