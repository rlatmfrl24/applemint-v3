import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkRuntime } from "./check-runtime.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LOG_PATH = resolve(PROJECT_ROOT, "reports/docker-auto-start.log");
let lastStatus = "";

function logStatus(message) {
	if (message === lastStatus) return;
	mkdirSync(dirname(LOG_PATH), { recursive: true });
	appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
	lastStatus = message;
}

function portIsOpen() {
	return new Promise((resolvePort) => {
		const socket = createConnection({ host: "127.0.0.1", port: 3000 });
		const finish = (open) => {
			socket.destroy();
			resolvePort(open);
		};
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.once("timeout", () => finish(false));
		socket.setTimeout(1_000);
	});
}

export async function startWhenDockerReady() {
	const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
		stdio: "ignore",
		windowsHide: true,
		timeout: 3_000,
	});
	if (docker.status !== 0) {
		logStatus("Docker 엔진이 꺼져 있습니다. 실행을 기다립니다.");
		return null;
	}
	if (await portIsOpen()) {
		logStatus("3000번 포트가 사용 중입니다. 새 서버를 실행하지 않습니다.");
		return null;
	}
	const supabase = spawnSync("supabase", ["status"], {
		cwd: PROJECT_ROOT,
		stdio: "pipe",
		windowsHide: true,
		timeout: 10_000,
	});
	if (supabase.status !== 0) {
		logStatus("Docker는 실행 중입니다. Supabase DB·인증 서비스 준비를 기다립니다.");
		return null;
	}
	logStatus("Docker 엔진 준비를 확인했습니다. Applemint 개발 서버를 자동 실행합니다.");
	const output = openSync(LOG_PATH, "a");
	try {
		const child = spawn(process.execPath, [resolve(PROJECT_ROOT, "scripts/dev/start-local.mjs")], {
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
				APPLEMINT_DOCKER_AUTO_START: "1",
			},
			stdio: ["ignore", output, output],
			windowsHide: true,
		});
		child.once("error", (error) => logStatus(`개발 서버 실행 오류: ${error.message}`));
		return child;
	} finally {
		closeSync(output);
	}
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	checkRuntime();
	// Windows named pipe는 프로세스 종료 시 해제되므로 오래된 잠금 파일이 남지 않는다.
	const lock = createServer((socket) => socket.destroy());
	lock.once("error", (error) => {
		if (error.code === "EADDRINUSE") return;
		logStatus(`자동 실행 대기 프로세스 오류: ${error.message}`);
		process.exitCode = 1;
	});
	lock.listen("\\\\.\\pipe\\applemint-local-docker-web", () => {
		logStatus("도커 자동 실행 대기 프로세스를 시작했습니다.");
		let child = null;
		let checking = false;
		const tick = async () => {
			if (child || checking) return;
			checking = true;
			try {
				child = await startWhenDockerReady();
				child?.once("close", (code) => {
					logStatus(`개발 서버가 종료되었습니다 (code=${code}). 도커 상태를 다시 확인합니다.`);
					child = null;
				});
			} catch (error) {
				logStatus(`자동 실행 확인 오류: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				checking = false;
			}
		};
		void tick();
		setInterval(tick, 10_000);
	});
}
