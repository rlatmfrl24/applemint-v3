import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSync, readFileSync, runtime } = vi.hoisted(() => ({
	spawnSync: vi.fn<
		(
			command: string,
			args: string[],
			options?: { env?: NodeJS.ProcessEnv }
		) => { status: number; stderr?: string; stdout?: string }
	>(() => ({ status: 0 })),
	readFileSync: vi.fn(),
	runtime: {
		supabaseUrl: "http://localhost:54321",
		publishableKey: "local-public-key",
		secretKey: "private-server-key",
		internalSecret: "private-worker-key",
		databaseContainer: "supabase_db_local-verify",
	},
}));
vi.mock("node:child_process", () => ({ spawnSync }));
vi.mock("node:fs", () => ({ readFileSync }));
readFileSync.mockReturnValue(JSON.stringify(runtime));

import * as launcher from "./start-local.mjs";

describe("local startup", () => {
	const containers = () =>
		["db", "auth", "rest", "kong"].map((service) => ({
			Name: `/supabase_${service}_local-verify`,
			State: { Running: true, Health: { Status: "healthy" } },
			HostConfig: {
				PortBindings:
					service === "db"
						? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }] }
						: service === "kong"
							? { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] }
							: {},
			},
		}));
	beforeEach(() => {
		spawnSync.mockReset().mockImplementation((_command, args) => ({
			status: 0,
			stdout: args[0] === "inspect" ? JSON.stringify(containers()) : "",
		}));
		readFileSync.mockReturnValue(JSON.stringify(runtime));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.stubEnv("APPLEMINT_DOCKER_AUTO_START", "");
	});
	afterEach(() => {
		process.exitCode = 0;
		vi.unstubAllEnvs();
	});

	it("starts Docker and only the configured existing containers before Next", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		let dockerReady = false;
		let stackReady = false;
		spawnSync.mockImplementation((command, args) => {
			if (command === "docker" && args[0] === "info") {
				const status = dockerReady ? 0 : 1;
				dockerReady = true;
				return { status };
			}
			if (args[0] === "inspect") {
				const stack = containers();
				stack[0].State.Running = stackReady;
				return { status: 0, stdout: JSON.stringify(stack) };
			}
			if (args[0] === "start") stackReady = true;
			return { status: 0 };
		});
		launcher.startLocal();
		expect(spawnSync.mock.calls.slice(0, 3).map(([command, args]) => [command, args])).toEqual([
			["docker", ["info", "--format", "{{.ServerVersion}}"]],
			["docker", ["desktop", "start", "--timeout", "120"]],
			["docker", ["info", "--format", "{{.ServerVersion}}"]],
		]);
		expect(spawnSync).toHaveBeenCalledWith(
			"docker",
			["start", ...containers().map((container) => container.Name.slice(1))],
			expect.anything()
		);
		expect(spawnSync.mock.calls.some(([command]) => command === "supabase")).toBe(false);
		expect(spawnSync.mock.calls.at(-1)?.slice(0, 2)).toEqual([
			process.execPath,
			expect.arrayContaining(["dev", "--hostname", "127.0.0.1", "--port", "3000"]),
		]);
		const options = spawnSync.mock.calls.at(-1)?.[2];
		expect(options?.env).toMatchObject({
			NEXT_PUBLIC_SUPABASE_URL: runtime.supabaseUrl,
			SUPABASE_SECRET_KEY: runtime.secretKey,
			CRAWL_INTERNAL_SECRET: runtime.internalSecret,
		});
	});

	it("reuses healthy configured containers without restarting or resetting them", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		launcher.startLocal();
		expect(spawnSync.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
			["docker", "info"],
			["docker", "inspect"],
			[process.execPath, expect.stringMatching(/next[/\\]dist[/\\]bin[/\\]next$/u)],
		]);
	});

	it("does not start Supabase or Next if Docker cannot become ready", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		spawnSync.mockReturnValue({ status: 1 });
		expect(() => launcher.startLocal()).toThrow(/Docker/u);
		expect(spawnSync.mock.calls.every(([command]) => command === "docker")).toBe(true);
	});

	it("does not reopen Docker if the user closes it during automatic startup", () => {
		vi.stubEnv("APPLEMINT_DOCKER_AUTO_START", "1");
		spawnSync.mockReturnValue({ status: 1 });
		expect(() => launcher.startLocal()).toThrow(/Docker/u);
		expect(spawnSync).toHaveBeenCalledOnce();
	});

	it("does not start or expose a stack with non-loopback bindings", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		const stack = containers();
		stack[0].HostConfig.PortBindings["5432/tcp"] = [{ HostIp: "", HostPort: "54322" }];
		spawnSync.mockImplementation((_command, args) => ({
			status: 0,
			stdout: args[0] === "inspect" ? JSON.stringify(stack) : "",
		}));
		expect(() => launcher.startLocal()).toThrow(/loopback/u);
		expect(spawnSync.mock.calls.every(([command]) => command === "docker")).toBe(true);
		expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("private-server-key"));
	});

	it("automatic startup waits for auth and never restarts manually stopped containers", () => {
		vi.stubEnv("APPLEMINT_DOCKER_AUTO_START", "1");
		const stack = containers();
		stack[1].State.Health.Status = "starting";
		spawnSync.mockImplementation((_command, args) => ({
			status: 0,
			stdout: args[0] === "inspect" ? JSON.stringify(stack) : "",
		}));
		expect(() => launcher.startLocal()).toThrow(/준비/u);
		expect(spawnSync.mock.calls.every(([, args]) => ["info", "inspect"].includes(args[0]))).toBe(
			true
		);
	});

	it("preserves a Next startup failure without falling back to another port", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		spawnSync.mockImplementation((command, args) => ({
			status: command === process.execPath ? 1 : 0,
			stdout: args[0] === "inspect" ? JSON.stringify(containers()) : "",
		}));
		launcher.startLocal();
		expect(process.exitCode).toBe(1);
		expect(spawnSync.mock.calls.filter(([command]) => command === process.execPath)).toHaveLength(
			1
		);
	});

	it("leaves existing accounts untouched when local authentication is missing", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		readFileSync.mockImplementation(() => {
			throw new Error("missing file");
		});
		expect(() => launcher.startLocal()).toThrow(/dev:local:prepare/u);
		expect(spawnSync).not.toHaveBeenCalled();
	});
});
