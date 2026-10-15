import { defineConfig, devices } from "@playwright/test";
import { getE2ERuntime } from "./e2e/support/runtime";

const runtime = getE2ERuntime();
const api = new URL(runtime.supabaseUrl);
const base = new URL(runtime.baseUrl);
if (
	!["localhost", "127.0.0.1"].includes(api.hostname) ||
	api.port !== "54321" ||
	!["localhost", "127.0.0.1"].includes(base.hostname) ||
	base.port !== "3000"
) {
	throw new Error(
		"북마크 검증은 이미 실행 중인 localhost:3000과 로컬 DB만 사용합니다. DB 준비·초기화를 실행하지 마세요."
	);
}
export default defineConfig({
	testDir: "./e2e",
	workers: 1,
	timeout: 60000,
	retries: 0,
	expect: { timeout: 10000 },
	use: {
		...devices["Desktop Chrome"],
		viewport: { width: 1440, height: 900 },
		baseURL: runtime.baseUrl,
		trace: "off",
	},
	projects: [
		{ name: "setup", testMatch: /auth\.setup\.ts/u },
		{
			name: "bookmarks",
			testMatch:
				/bookmark(?:s|-ai|-manager|-move|-drag|-order|-navigation|-recommend|-settings|-p2|-ux)\.spec\.ts/u,
			dependencies: ["setup"],
			use: { storageState: "playwright/.auth/owner.json" },
		},
	],
});
