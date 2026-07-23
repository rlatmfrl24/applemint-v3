import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

interface E2ERuntime {
	baseUrl: string;
	supabaseUrl: string;
	anonKey: string;
	serviceRoleKey: string;
	internalSecret: string;
}

const authDir = resolve("playwright/.auth");
const authStatePath = resolve(authDir, "owner.json");
const runtimePath = resolve(authDir, "runtime.json");

function readRuntime(): E2ERuntime {
	try {
		return JSON.parse(readFileSync(runtimePath, "utf8")) as E2ERuntime;
	} catch (error) {
		throw new Error(
			`E2E 실행 환경을 읽을 수 없습니다. 먼저 pnpm run e2e:prepare를 실행하세요. (${error instanceof Error ? error.message : String(error)})`
		);
	}
}

const runtime = readRuntime();

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 30_000,
	expect: {
		timeout: 7_500,
	},
	reporter: [["list"]],
	use: {
		baseURL: runtime.baseUrl,
		trace: "off",
		screenshot: "only-on-failure",
		video: "off",
	},
	webServer: {
		command: "pnpm exec next dev --turbopack -p 3100",
		url: runtime.baseUrl,
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: "ignore",
		stderr: "pipe",
		env: {
			...process.env,
			NEXT_PUBLIC_SUPABASE_URL: runtime.supabaseUrl,
			NEXT_PUBLIC_SUPABASE_ANON_KEY: runtime.anonKey,
			SUPABASE_URL: runtime.supabaseUrl,
			SUPABASE_SERVICE_ROLE_KEY: runtime.serviceRoleKey,
			CRAWL_INTERNAL_SECRET: runtime.internalSecret,
		},
	},
	projects: [
		{
			name: "setup",
			testMatch: /.*\.setup\.ts/,
			use: {
				...devices["Desktop Chrome"],
				storageState: undefined,
			},
		},
		{
			name: "chromium",
			testIgnore: /.*\.setup\.ts/,
			dependencies: ["setup"],
			use: {
				...devices["Desktop Chrome"],
				storageState: authStatePath,
			},
		},
	],
});
