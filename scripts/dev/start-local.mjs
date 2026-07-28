import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNTIME_PATH = resolve("playwright/.auth/local-dev.json");

function readRuntime() {
	try {
		return JSON.parse(readFileSync(RUNTIME_PATH, "utf8"));
	} catch (error) {
		throw new Error(
			`로컬 인증 환경을 읽을 수 없습니다. 먼저 pnpm dev:local:prepare를 실행하세요. (${error instanceof Error ? error.message : String(error)})`
		);
	}
}

function main() {
	const runtime = readRuntime();
	const result = spawnSync("pnpm", ["exec", "next", "dev"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			NEXT_PUBLIC_SUPABASE_URL: runtime.supabaseUrl,
			NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: runtime.publishableKey,
			SUPABASE_URL: runtime.supabaseUrl,
			SUPABASE_SECRET_KEY: runtime.secretKey,
			CRAWL_INTERNAL_SECRET: runtime.internalSecret,
		},
		stdio: "inherit",
		shell: process.platform === "win32",
	});

	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
