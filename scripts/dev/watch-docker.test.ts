import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
	dockerReady: false,
	supabaseReady: true,
	portOpen: false,
	spawnSync: vi.fn(),
	spawn: vi.fn(),
	readRuntime: vi.fn(() => ({})),
	inspectLocalStack: vi.fn(),
}));
vi.mock("./start-local.mjs", () => ({
	readRuntime: boundary.readRuntime,
	inspectLocalStack: boundary.inspectLocalStack,
}));
vi.mock("node:child_process", () => ({ spawnSync: boundary.spawnSync, spawn: boundary.spawn }));
vi.mock("node:fs", () => ({
	appendFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	openSync: vi.fn(() => 123),
	closeSync: vi.fn(),
}));
vi.mock("node:net", () => ({
	createServer: vi.fn(),
	createConnection: () => {
		const socket = Object.assign(new EventEmitter(), {
			destroy: vi.fn(),
			setTimeout: vi.fn(),
		});
		queueMicrotask(() => socket.emit(boundary.portOpen ? "connect" : "error"));
		return socket;
	},
}));

import * as watcher from "./watch-docker.mjs";

describe("automatic startup when Docker becomes ready", () => {
	beforeEach(() => {
		boundary.dockerReady = false;
		boundary.supabaseReady = true;
		boundary.portOpen = false;
		boundary.inspectLocalStack
			.mockReset()
			.mockImplementation(() => ({ ready: boundary.supabaseReady }));
		boundary.spawn.mockReset().mockImplementation(() => new EventEmitter());
		boundary.spawnSync.mockReset().mockImplementation((command) => ({
			status: (command === "supabase" ? boundary.supabaseReady : boundary.dockerReady) ? 0 : 1,
		}));
	});

	it("waits while Docker is off, then launches the real local entry point after it starts", async () => {
		expect(await watcher.startWhenDockerReady()).toBeNull();
		expect(boundary.spawn).not.toHaveBeenCalled();
		boundary.dockerReady = true;
		expect(await watcher.startWhenDockerReady()).not.toBeNull();
		expect(boundary.spawn).toHaveBeenCalledOnce();
		const [command, args, options] = boundary.spawn.mock.calls[0];
		expect(command).toBe(process.execPath);
		expect(args[0]).toMatch(/scripts[/\\]dev[/\\]start-local\.mjs$/u);
		expect(options).toMatchObject({
			windowsHide: true,
			env: { APPLEMINT_DOCKER_AUTO_START: "1" },
		});
	});

	it("does not replace a server already listening on port 3000", async () => {
		boundary.dockerReady = true;
		boundary.portOpen = true;
		expect(await watcher.startWhenDockerReady()).toBeNull();
		expect(boundary.spawn).not.toHaveBeenCalled();
	});

	it("waits for Supabase readiness instead of starting Next during container startup", async () => {
		boundary.dockerReady = true;
		boundary.supabaseReady = false;
		expect(await watcher.startWhenDockerReady()).toBeNull();
		expect(boundary.spawn).not.toHaveBeenCalled();
		boundary.supabaseReady = true;
		expect(await watcher.startWhenDockerReady()).not.toBeNull();
		expect(boundary.spawn).toHaveBeenCalledOnce();
	});

	it("stops only its own web process tree when Docker goes away", async () => {
		boundary.dockerReady = true;
		const child = await watcher.startWhenDockerReady();
		if (!child) throw new Error("Expected an owned server");
		Object.defineProperty(child, "pid", { value: 45678 });
		boundary.dockerReady = false;
		boundary.spawn.mockClear();
		boundary.spawnSync.mockClear();
		expect(await watcher.startWhenDockerReady(child)).toBe(child);
		expect(boundary.spawnSync).toHaveBeenCalledWith(
			"taskkill",
			["/PID", "45678", "/T", "/F"],
			expect.objectContaining({ windowsHide: true })
		);
		expect(boundary.spawn).not.toHaveBeenCalled();
	});
	it("does not kill the web server when a Docker status query only times out", async () => {
		boundary.dockerReady = true;
		const child = await watcher.startWhenDockerReady();
		if (!child) throw new Error("Expected an owned server");
		Object.defineProperty(child, "pid", { value: 45678 });
		boundary.spawnSync.mockClear().mockReturnValue({ status: null, error: { code: "ETIMEDOUT" } });
		expect(await watcher.startWhenDockerReady(child)).toBe(child);
		expect(boundary.spawnSync.mock.calls.some(([command]) => command === "taskkill")).toBe(false);
	});
});
