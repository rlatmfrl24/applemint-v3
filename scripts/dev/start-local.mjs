import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUNTIME_PATH = resolve("playwright/.auth/local-dev.json");

export function readRuntime() {
	try {
		return JSON.parse(readFileSync(RUNTIME_PATH, "utf8"));
	} catch (error) {
		throw new Error(
			`로컬 인증 환경을 읽을 수 없습니다. 먼저 pnpm dev:local:prepare를 실행하세요. (${error instanceof Error ? error.message : String(error)})`
		);
	}
}

export function inspectLocalStack(runtime) {
	if (!/^supabase_db_[a-z0-9_-]+$/u.test(runtime.databaseContainer ?? "")) {
		throw new Error("로컬 인증 환경의 databaseContainer가 올바르지 않습니다.");
	}
	const api = new URL(runtime.supabaseUrl);
	if (
		api.protocol !== "http:" ||
		!["127.0.0.1", "localhost"].includes(api.hostname) ||
		api.port !== "54321"
	) {
		throw new Error("로컬 Supabase API는 localhost:54321이어야 합니다.");
	}
	const project = runtime.databaseContainer.slice("supabase_db_".length);
	const names = ["db", "auth", "rest", "kong"].map((service) => `supabase_${service}_${project}`);
	const result = spawnSync("docker", ["inspect", ...names], {
		encoding: "utf8",
		timeout: 10_000,
		windowsHide: true,
	});
	if (result.status !== 0) {
		throw new Error("설정한 로컬 Supabase 컨테이너를 찾지 못했습니다. 새 DB는 생성하지 않습니다.");
	}
	const containers = JSON.parse(result.stdout);
	if (
		containers.length !== names.length ||
		containers.some((container, index) => container.Name !== `/${names[index]}`)
	) {
		throw new Error("설정한 로컬 Supabase 컨테이너와 조회 결과가 다릅니다.");
	}
	for (const container of containers) {
		const bindings = container.HostConfig.PortBindings ?? {};
		if (
			Object.values(bindings)
				.flatMap((ports) => ports ?? [])
				.some((port) => !["127.0.0.1", "::1"].includes(port.HostIp))
		) {
			throw new Error(
				"로컬 Supabase의 loopback 포트 제한을 확인하세요. 서비스를 시작하지 않았습니다."
			);
		}
	}
	if (
		!containers[0].HostConfig.PortBindings?.["5432/tcp"]?.some(
			(port) => port.HostPort === "54322"
		) ||
		!containers[3].HostConfig.PortBindings?.["8000/tcp"]?.some((port) => port.HostPort === api.port)
	) {
		throw new Error("설정한 로컬 DB·API의 loopback 포트가 일치하지 않습니다.");
	}
	return {
		names,
		ready: containers.every(
			(container) =>
				container.State.Running &&
				(!container.State.Health || container.State.Health.Status === "healthy")
		),
	};
}

function ensureLocalStack(runtime) {
	let stack = inspectLocalStack(runtime);
	if (!stack.ready) {
		if (process.env.APPLEMINT_DOCKER_AUTO_START === "1") {
			throw new Error("로컬 Supabase DB·인증·API 서비스 준비를 기다립니다.");
		}
		console.log("설정한 기존 Supabase 컨테이너만 시작합니다. DB를 초기화하지 않습니다.");
		const supabase = spawnSync("docker", ["start", ...stack.names], {
			stdio: "ignore",
			windowsHide: true,
			timeout: 30_000,
		});
		if (supabase.status !== 0) {
			throw new Error("로컬 Supabase를 시작하지 못했습니다. 웹 서버는 실행하지 않았습니다.");
		}
		const pause = new Int32Array(new SharedArrayBuffer(4));
		for (let attempt = 0; attempt < 60; attempt++) {
			stack = inspectLocalStack(runtime);
			if (stack.ready) break;
			Atomics.wait(pause, 0, 0, 1_000);
		}
		if (!stack.ready) throw new Error("로컬 Supabase 서비스가 아직 준비되지 않았습니다.");
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
	ensureLocalStack(runtime);
	console.log("로컬 Supabase가 준비되었습니다. 웹 서버: http://localhost:3000/main/bookmarks");
	if (process.env.APPLEMINT_DOCKER_AUTO_START !== "1") {
		console.log("웹 서버를 사용하는 동안 이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.");
	}
	const result = spawnSync(
		process.execPath,
		[
			resolve("node_modules/next/dist/bin/next"),
			"dev",
			"--hostname",
			"127.0.0.1",
			"--port",
			"3000",
		],
		{
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
			windowsHide: true,
		}
	);

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
