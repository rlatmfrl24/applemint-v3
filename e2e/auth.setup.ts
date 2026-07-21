import { resolve } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { getE2ERuntime } from "./support/runtime";

const authStatePath = resolve("playwright/.auth/owner.json");

setup("로컬 소유자로 로그인한다", async ({ page }) => {
	const runtime = getE2ERuntime();

	await page.goto("/main");
	await expect(page).toHaveURL(/\/login$/u);

	await page.getByLabel("Email").fill(runtime.ownerEmail);
	await page.getByLabel("Password").fill(runtime.ownerPassword);
	await page.getByRole("button", { name: "Sign In" }).click();

	await expect
		.poll(async () =>
			(await page.context().cookies()).some((cookie) => cookie.name.startsWith("sb-"))
		)
		.toBe(true);
	await expect(page).toHaveURL(/\/main$/u);
	await expect(page.getByRole("link", { name: "Main", exact: true })).toBeVisible();
	await page.context().storageState({ path: authStatePath });
});
