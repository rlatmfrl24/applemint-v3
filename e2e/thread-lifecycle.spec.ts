import { expect, test } from "@playwright/test";
import { clearThreadTables, countThreads, getThreadIdByUrl, seedThreads } from "./support/database";

test.beforeEach(async () => {
	await clearThreadTables();
});

test("Main에서 Quick과 Trash를 거쳐 스레드를 복원한다", async ({ page }) => {
	const [thread] = await seedThreads("inbox", 1, { prefix: "lifecycle" });
	const originalId = String(thread.id);
	const url = thread.url as string;
	const title = thread.title as string;
	const card = () => page.getByTestId("thread-card").filter({ hasText: title });

	await page.goto("/main");
	await expect(card()).toBeVisible();
	await card().getByRole("button", { name: "Quick Save" }).click();
	await expect(card()).toHaveCount(0);
	await expect.poll(() => countThreads("saved")).toBe(1);
	expect(await getThreadIdByUrl("saved", url)).toBe(originalId);

	await page.getByRole("link", { name: "Quick", exact: true }).click();
	await expect(page).toHaveURL(/\/main\/quick$/u);
	await expect(card()).toBeVisible();
	await card().getByRole("button", { name: "Trash" }).click();
	await expect(card()).toHaveCount(0);
	await expect.poll(() => countThreads("trash")).toBe(1);
	expect(await getThreadIdByUrl("trash", url)).toBe(originalId);

	await page.getByRole("link", { name: "Trash", exact: true }).click();
	await expect(page).toHaveURL(/\/main\/trash$/u);
	await expect(card()).toBeVisible();
	await card().getByRole("button", { name: "Restore" }).click();
	await expect(card()).toHaveCount(0);
	await expect.poll(() => countThreads("inbox")).toBe(1);
	expect(await getThreadIdByUrl("inbox", url)).toBe(originalId);

	await page.getByRole("link", { name: "Main", exact: true }).click();
	await expect(page).toHaveURL(/\/main$/u);
	await expect(card()).toBeVisible();
});
