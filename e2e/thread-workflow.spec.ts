import { expect, test } from "@playwright/test";
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
