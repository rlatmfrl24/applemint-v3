import { expect, test } from "@playwright/test";
import type { ThreadPage } from "../lib/thread-list-contract";
import { clearThreadTables, countThreads, getThreadIdByUrl, seedThreads } from "./support/database";

test.beforeEach(async () => {
	await clearThreadTables();
});

test("좁은 모바일 화면에서 모든 필터 칩을 끝까지 보고 선택한다", async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await seedThreads("inbox", 12, { prefix: "mobile-normal" });
	const [arcaliveThread] = await seedThreads("inbox", 1, {
		prefix: "mobile-arcalive",
		type: "arcalive",
	});

	await page.goto("/main");
	const arcaliveFilter = page.getByRole("radio", { name: /^arcalive\s*1$/u });
	const siteFilter = page.getByRole("radio", { name: /^e2e\.applemint\.local\s*12$/u });
	await expect(arcaliveFilter).toBeInViewport({ ratio: 1 });
	await expect(siteFilter).toBeInViewport({ ratio: 1 });

	await arcaliveFilter.click();
	await expect(arcaliveFilter).toBeChecked();
	const cards = page.getByTestId("thread-card");
	await expect(cards).toHaveCount(1);
	await expect(cards.first()).toContainText(arcaliveThread.title);

	await siteFilter.click();
	await expect(siteFilter).toBeChecked();
	await expect(cards).toHaveCount(12);
});

test("현재 필터에 새 글이 있을 때만 알림을 표시하고 눌러서 새 글을 본다", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: "dark" });
	const [first, second, remaining] = await seedThreads("inbox", 3, { prefix: "alert-normal" });
	await seedThreads("inbox", 1, { prefix: "alert-arcalive", type: "arcalive" });

	await page.goto("/main");
	const normal = page.getByRole("radio", { name: /^normal\s*\d+$/u });
	await normal.click();
	await expect(normal).toBeChecked();

	const cards = page.getByTestId("thread-card");
	const notice = page.getByText("새 글이 도착했어요", { exact: true });
	const showNew = page.getByRole("button", { name: "새 글 보기" });
	const filterGroup = page.getByRole("radiogroup").filter({ has: normal });
	const gapAfterFilters = async () => {
		const filters = await filterGroup.boundingBox();
		const firstCard = await cards.first().boundingBox();
		if (!filters || !firstCard) throw new Error("필터와 첫 글이 표시되지 않습니다.");
		return firstCard.y - (filters.y + filters.height);
	};
	await expect(cards).toHaveCount(3);
	await expect(showNew).toHaveCount(0);
	const emptyGap = await gapAfterFilters();
	expect(emptyGap).toBeGreaterThan(0);
	expect(emptyGap).toBeLessThan(24);

	const trashAndRefresh = async (title: string, hasNew: boolean) => {
		const refreshed = page.waitForResponse((response) => {
			const { pathname, searchParams } = new URL(response.url());
			return (
				pathname.startsWith("/api/trpc/") &&
				pathname.slice("/api/trpc/".length).split(",").includes("thread.list") &&
				searchParams.get("input")?.includes('"filterType":"normal"') === true
			);
		});
		await cards.filter({ hasText: title }).getByRole("button", { name: "Trash" }).click();
		const response = await refreshed;
		expect(response.ok()).toBe(true);
		const procedures = new URL(response.url()).pathname.slice("/api/trpc/".length).split(",");
		const body: { result?: { data: ThreadPage } }[] = await response.json();
		expect(body[procedures.indexOf("thread.list")]?.result?.data.inboxWindow?.hasNew).toBe(hasNew);
	};

	await seedThreads("inbox", 1, { prefix: "alert-other", type: "arcalive" });
	await trashAndRefresh(first.title, false);
	await expect(cards).toHaveCount(2);
	await expect(showNew).toHaveCount(0);

	const [incoming] = await seedThreads("inbox", 1, { prefix: "alert-incoming" });
	await trashAndRefresh(second.title, true);
	await expect(notice).toBeInViewport({ ratio: 1 });
	await expect(showNew).toBeInViewport({ ratio: 1 });
	await expect(cards).toHaveCount(1);
	await expect(cards.first()).toContainText(remaining.title);
	await page.screenshot({ path: testInfo.outputPath("inbox-alert-mobile-dark.png") });

	await page.setViewportSize({ width: 320, height: 800 });
	await expect(notice).toBeInViewport({ ratio: 1 });
	await expect(showNew).toBeInViewport({ ratio: 1 });
	await expect(page.getByRole("radio", { name: /^arcalive\s*2$/u })).toBeInViewport({
		ratio: 1,
	});

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.emulateMedia({ colorScheme: "light" });
	await expect(page.locator("html")).toHaveClass(/\blight\b/u);
	await expect(notice).toBeInViewport({ ratio: 1 });
	await expect(showNew).toBeInViewport({ ratio: 1 });

	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
	await showNew.click();
	await expect(cards).toHaveCount(2);
	await expect(cards.first()).toContainText(incoming.title);
	await expect(normal).toBeChecked();
	await expect(showNew).toHaveCount(0);
	await expect(notice).toHaveCount(0);
	expect(await gapAfterFilters()).toBeCloseTo(emptyGap, 0);
});

test("Inbox 페이지네이션과 Main → Quick → Trash → Main 복원을 검증한다", async ({ page }) => {
	const threads = await seedThreads("inbox", 31, { prefix: "thread-workflow" });
	const selectedThread = threads[0];
	const originalId = String(selectedThread.id);
	const url = selectedThread.url as string;
	const title = selectedThread.title as string;
	const card = () => page.getByTestId("thread-card").filter({ hasText: title });

	await page.goto("/main");
	const cards = page.getByTestId("thread-card");
	await expect(cards).toHaveCount(24);

	await page.getByTestId("inbox-load-more-sentinel").scrollIntoViewIfNeeded();
	await expect(cards).toHaveCount(31);
	const urls = await cards.evaluateAll((elements) =>
		elements.map((element) => element.getAttribute("data-thread-url"))
	);
	expect(new Set(urls).size).toBe(31);

	await card().getByRole("button", { name: "Quick Save" }).click();
	await expect(card()).toHaveCount(0);
	await expect.poll(() => countThreads("saved")).toBe(1);
	expect(await getThreadIdByUrl("saved", url)).toBe(originalId);

	await page.getByRole("link", { name: "Quick", exact: true }).click();
	await expect(card()).toBeVisible();
	await card().getByRole("button", { name: "Trash" }).click();
	await expect.poll(() => countThreads("trash")).toBe(1);
	expect(await getThreadIdByUrl("trash", url)).toBe(originalId);

	await page.getByRole("link", { name: "Trash", exact: true }).click();
	await expect(card()).toBeVisible();
	await card().getByRole("button", { name: "Restore" }).click();
	await expect.poll(() => countThreads("inbox")).toBe(31);
	expect(await getThreadIdByUrl("inbox", url)).toBe(originalId);

	await page.getByRole("link", { name: "Main", exact: true }).click();
	await expect(card()).toBeVisible();
});
