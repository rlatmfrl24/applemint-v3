import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

export function startLocal() {
	const runtime = readRuntime();
	const dockerOptions = { stdio: "ignore", timeout: 10_000, windowsHide: true };
	const dockerArgs = ["info", "--format", "{{.ServerVersion}}"];
	if (spawnSync("docker", dockerArgs, dockerOptions).status !== 0) {
		if (process.env.APPLEMINT_DOCKER_AUTO_START === "1") {
			throw new Error("Docker 엔진이 종료되었습니다. 다음 실행까지 기다립니다.");
		}
		console.log("Docker Desktop을 시작합니다. 엔진 준비까지 최대 2분 기다립니다.");
		const desktop = spawnSync("docker", ["desktop", "start", "--timeout", "120"], {
			stdio: "inherit",
			windowsHide: true,
			timeout: 130_000,
		});
		if (desktop.status !== 0 || spawnSync("docker", dockerArgs, dockerOptions).status !== 0) {
			throw new Error("Docker 엔진을 시작하지 못했습니다. Docker Desktop의 오류를 확인하세요.");
		}
	}
	console.log("Docker 엔진이 준비되었습니다.");

	// Supabase CLI 출력에 서버 비밀 키가 포함되므로 터미널에 전달하지 않는다.
	const supabaseOptions = { cwd: process.cwd(), stdio: "pipe", windowsHide: true };
	if (spawnSync("supabase", ["status"], { ...supabaseOptions, timeout: 15_000 }).status !== 0) {
		console.log("기존 로컬 Supabase 자료로 서비스를 시작합니다. DB를 초기화하지 않습니다.");
		const supabase = spawnSync("supabase", ["start"], {
			...supabaseOptions,
			timeout: 300_000,
		});
		if (supabase.status !== 0) {
			throw new Error("로컬 Supabase를 시작하지 못했습니다. 웹 서버는 실행하지 않았습니다.");
		}
	}
	console.log("로컬 Supabase가 준비되었습니다. 웹 서버: http://localhost:3000/main/bookmarks");
	console.log("웹 서버를 사용하는 동안 이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.");
	const result = spawnSync("pnpm", ["exec", "next", "dev", "--port", "3000"], {
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

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		startLocal();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
