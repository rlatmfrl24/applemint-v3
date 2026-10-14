import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSync, readFileSync, runtime } = vi.hoisted(() => ({
	spawnSync: vi.fn<
		(
			command: string,
			args: string[],
			options?: { env?: NodeJS.ProcessEnv }
		) => { status: number; stderr?: string }
	>(() => ({ status: 0 })),
	readFileSync: vi.fn(),
	runtime: {
		supabaseUrl: "http://localhost:54321",
		publishableKey: "local-public-key",
		secretKey: "private-server-key",
		internalSecret: "private-worker-key",
	},
}));
vi.mock("node:child_process", () => ({ spawnSync }));
vi.mock("node:fs", () => ({ readFileSync }));
readFileSync.mockReturnValue(JSON.stringify(runtime));

import * as launcher from "./start-local.mjs";

describe("local startup", () => {
	beforeEach(() => {
		spawnSync.mockReset().mockReturnValue({ status: 0 });
		readFileSync.mockReturnValue(JSON.stringify(runtime));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.stubEnv("APPLEMINT_DOCKER_AUTO_START", "");
	});
	afterEach(() => {
		process.exitCode = 0;
		vi.unstubAllEnvs();
	});

	it("starts Docker and the existing local stack before starting Next on port 3000", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		spawnSync.mockImplementation((command, args) => {
			if (command === "docker" && args[0] === "info") {
				return { status: spawnSync.mock.calls.length === 1 ? 1 : 0 };
			}
			if (command === "supabase" && args[0] === "status") return { status: 1 };
			return { status: 0 };
		});
		launcher.startLocal();
		expect(spawnSync.mock.calls.map(([command, args]) => [command, args])).toEqual([
			["docker", ["info", "--format", "{{.ServerVersion}}"]],
			["docker", ["desktop", "start", "--timeout", "120"]],
			["docker", ["info", "--format", "{{.ServerVersion}}"]],
			["supabase", ["status"]],
			["supabase", ["start"]],
			["pnpm", ["exec", "next", "dev", "--port", "3000"]],
		]);
		const options = spawnSync.mock.calls.at(-1)?.[2];
		expect(options?.env).toMatchObject({
			NEXT_PUBLIC_SUPABASE_URL: runtime.supabaseUrl,
			SUPABASE_SECRET_KEY: runtime.secretKey,
			CRAWL_INTERNAL_SECRET: runtime.internalSecret,
		});
	});

	it("reuses running Docker and Supabase without restarting or resetting them", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		launcher.startLocal();
		expect(spawnSync.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
			["docker", "info"],
			["supabase", "status"],
			["pnpm", "exec"],
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

	it("does not expose CLI secrets or start Next after a Supabase failure", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		spawnSync.mockImplementation((command) => ({
			status: command === "supabase" ? 1 : 0,
			stderr: "private-server-key",
		}));
		expect(() => launcher.startLocal()).toThrow(/Supabase/u);
		expect(() => launcher.startLocal()).not.toThrow(/private-server-key/u);
		expect(spawnSync.mock.calls.some(([command]) => command === "pnpm")).toBe(false);
		expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("private-server-key"));
	});

	it("preserves a Next startup failure without falling back to another port", () => {
		expect(launcher.startLocal).toBeTypeOf("function");
		spawnSync.mockImplementation((command) => ({ status: command === "pnpm" ? 1 : 0 }));
		launcher.startLocal();
		expect(process.exitCode).toBe(1);
		expect(spawnSync.mock.calls.filter(([command]) => command === "pnpm")).toHaveLength(1);
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
