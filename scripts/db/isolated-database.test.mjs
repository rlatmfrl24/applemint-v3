import { mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand, withVerificationDatabase } from "./isolated-database.mjs";

const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "applemint-db-test-"));
	roots.push(root);
	mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
	mkdirSync(join(root, "supabase", "tests"));
	writeFileSync(
		join(root, "supabase", "config.toml"),
		'project_id = "live-project"\n[db]\nport = 54322\nshadow_port = 54320\nmajor_version = 17\n'
	);
	writeFileSync(join(root, "supabase", "migrations", "20260101000000_init.sql"), "select 1;");
	writeFileSync(join(root, "supabase", "tests", "schema.test.sql"), "select 2;");
	writeFileSync(join(root, "supabase", "seed.sql"), "select 3;");
	return root;
}

function fakeCommands() {
	let network;
	const run = vi.fn(async (_command, args, options) => {
		if (args[0] === "--version") return { stdout: "2.109.1\n", status: 0 };
		if (args[0] === "network" && args[1] === "create") {
			roots.push(options.cwd);
			const name = args.at(-1);
			const label = args[args.indexOf("--label") + 1].split("=");
			network = { Id: "owned-network-id", Name: name, Labels: { [label[0]]: label[1] } };
		}
		if (args[0] === "network" && args[1] === "inspect") {
			return { stdout: JSON.stringify([network]), status: 0 };
		}
		if (args[0] === "inspect") {
			const marker = JSON.parse(readFileSync(join(options.cwd, "owner.json"), "utf8"));
			return {
				status: 0,
				stdout: JSON.stringify([
					{
						Name: `/supabase_db_${marker.project}`,
						Config: { Labels: { "com.supabase.cli.project": marker.project } },
						HostConfig: {
							PortBindings: { "5432/tcp": [{ HostIp: "", HostPort: `${marker.port}` }] },
						},
						NetworkSettings: {
							Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: `${marker.port}` }] },
							Networks: { [marker.network]: { Aliases: ["db"] } },
						},
					},
				]),
			};
		}
		if (args[0] === "volume" && args[1] === "inspect") {
			const marker = JSON.parse(readFileSync(join(options.cwd, "owner.json"), "utf8"));
			return {
				status: 0,
				stdout: JSON.stringify([
					{ Name: args[2], Labels: { "com.supabase.cli.project": marker.project } },
				]),
			};
		}
		return { stdout: "", status: 0 };
	});
	return run;
}

describe("disposable database verification", () => {
	it("copies schema inputs into a unique project and uses its workdir and loopback network", async () => {
		const root = fixture();
		const run = fakeCommands();
		let workdir;
		await withVerificationDatabase(
			async (database) => {
				workdir = database.workdir;
				expect(database.project.length).toBeLessThanOrEqual(40);
				const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
				expect(config).toContain(`project_id = "${database.project}"`);
				expect(config).not.toContain("54322");
				expect(readFileSync(join(workdir, "supabase", "seed.sql"), "utf8")).toBe("select 3;");
				expect(readFileSync(join(workdir, "supabase", "tests", "schema.test.sql"), "utf8")).toBe(
					"select 2;"
				);
				await database.supabase(["test", "db", "--local"]);
			},
			{ root, run, env: { SUPABASE_WORKDIR: root } }
		);
		expect(() => readFileSync(join(workdir, "owner.json"))).toThrow();
		expect(readFileSync(join(root, "supabase", "config.toml"), "utf8")).toContain("live-project");
		const create = run.mock.calls.find(([, args]) => args[1] === "create");
		expect(create[1]).toContain("com.docker.network.bridge.host_binding_ipv4=127.0.0.1");
		const test = run.mock.calls.find(([, args]) => args[0] === "test");
		expect(test[1]).toEqual(expect.arrayContaining(["--workdir", workdir, "--network-id"]));
		expect(test[2].env.SUPABASE_WORKDIR).toBe(workdir);
		expect(run.mock.calls.some(([, args]) => args.includes("--all"))).toBe(false);
	});

	it("reuses an inherited owned database without starting or stopping a second one", async () => {
		const run = fakeCommands();
		await withVerificationDatabase(
			async (database) => {
				await withVerificationDatabase(
					async (nested) => {
						expect(nested.workdir).toBe(database.workdir);
					},
					{ root: database.root, run, env: database.env }
				);
			},
			{ root: fixture(), run, env: {} }
		);
		expect(
			run.mock.calls.filter(([, args]) => args[0] === "db" && args[1] === "start")
		).toHaveLength(1);
		expect(run.mock.calls.filter(([, args]) => args[0] === "stop")).toHaveLength(1);
	});

	it("rejects a forged inherited workdir before invoking a database command", async () => {
		const root = fixture();
		const run = fakeCommands();
		await expect(
			withVerificationDatabase(vi.fn(), {
				root,
				run,
				env: { APPLEMINT_VERIFY_DB_WORKDIR: root, APPLEMINT_VERIFY_DB_OWNER: "forged" },
			})
		).rejects.toThrow(/ownership/iu);
		expect(run).not.toHaveBeenCalled();
	});

	it("rejects another CLI version before creating Docker resources", async () => {
		const run = vi.fn(async () => ({ stdout: "2.110.0", status: 0 }));
		await expect(
			withVerificationDatabase(vi.fn(), { root: fixture(), run, env: {} })
		).rejects.toThrow("2.109.1");
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("rebinds only its own fresh container when Docker Desktop ignores the network default", async () => {
		const run = fakeCommands();
		const base = run.getMockImplementation();
		let rebound = false;
		run.mockImplementation(async (command, args, options) => {
			if (args[0] === "create") rebound = true;
			const result = await base(command, args, options);
			if (args[0] !== "inspect") return result;
			const containers = JSON.parse(result.stdout);
			const container = containers[0];
			container.Config.Image = "supabase/postgres:17-test";
			container.Config.Env = ["POSTGRES_PASSWORD=postgres"];
			container.Config.Entrypoint = ["sh", "-c", "docker-entrypoint.sh postgres"];
			container.Config.Cmd = ["-c", "max_connections=100"];
			container.Config.User = "postgres";
			container.Config.WorkingDir = "/var/lib/postgresql";
			container.Config.Healthcheck = {
				Test: ["CMD", "pg_isready", "-U", "postgres"],
				Interval: 10_000_000_000,
				Timeout: 2_000_000_000,
				Retries: 3,
			};
			container.HostConfig.Binds = [`${container.Name.slice(1)}:/var/lib/postgresql/data`];
			if (!rebound) container.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0";
			return { ...result, stdout: JSON.stringify(containers) };
		});
		await withVerificationDatabase(vi.fn(), { root: fixture(), run, env: {} });
		const create = run.mock.calls.find(([, args]) => args[0] === "create");
		expect(create[1]).toContain("--publish");
		expect(create[1]).toEqual(
			expect.arrayContaining([
				"--user",
				"postgres",
				"--workdir",
				"/var/lib/postgresql",
				"--health-cmd",
				"--health-interval",
				"10000000000ns",
				"--health-timeout",
				"2000000000ns",
				"--health-retries",
				"3",
			])
		);
		expect(create[1].slice(-5)).toEqual([
			"supabase/postgres:17-test",
			"-c",
			"docker-entrypoint.sh postgres",
			"-c",
			"max_connections=100",
		]);
		expect(create[1].find((arg) => /^127\.0\.0\.1:\d+:5432$/u.test(arg))).toBeTruthy();
		expect(run.mock.calls.find(([, args]) => args[0] === "rm")[1]).not.toContain("--volumes");
	});

	it("cleans up a partially started database when migration replay fails", async () => {
		const run = fakeCommands();
		const base = run.getMockImplementation();
		run.mockImplementation(async (command, args, options) => {
			if (args[0] === "db" && args[1] === "start") throw new Error("migration failed");
			return base(command, args, options);
		});
		await expect(
			withVerificationDatabase(vi.fn(), { root: fixture(), run, env: {} })
		).rejects.toThrow("migration failed");
		expect(
			run.mock.calls.some(([, args]) => args[0] === "stop" && args.includes("--no-backup"))
		).toBe(true);
		expect(run.mock.calls.some(([, args]) => args[0] === "network" && args[1] === "rm")).toBe(true);
	});

	it("preserves task failures after cleaning up the owned project", async () => {
		const run = fakeCommands();
		await expect(
			withVerificationDatabase(
				async () => {
					throw new Error("pgTAP failed");
				},
				{
					root: fixture(),
					run,
					env: {},
				}
			)
		).rejects.toThrow("pgTAP failed");
		expect(run.mock.calls.some(([, args]) => args[0] === "stop")).toBe(true);
	});

	it("refuses cleanup when the network ownership label changes", async () => {
		const run = fakeCommands();
		const base = run.getMockImplementation();
		let changed = false;
		run.mockImplementation(async (command, args, options) => {
			if (changed && args[0] === "network" && args[1] === "inspect") {
				return { stdout: JSON.stringify([{ Labels: {} }]), status: 0 };
			}
			return base(command, args, options);
		});
		await expect(
			withVerificationDatabase(
				async () => {
					changed = true;
				},
				{
					root: fixture(),
					run,
					env: {},
				}
			)
		).rejects.toThrow(/ownership/iu);
		expect(run.mock.calls.some(([, args]) => args[0] === "stop")).toBe(false);
	});

	it("fails a command on nonzero exit and supports cancellation", async () => {
		await expect(runCommand(process.execPath, ["-e", "process.exit(3)"])).rejects.toThrow(/3/u);
		const controller = new AbortController();
		const pending = runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
			signal: controller.signal,
		});
		controller.abort();
		await expect(pending).rejects.toThrow();
	});

	it.skipIf(process.platform === "win32")(
		"kills a POSIX command that ignores SIGTERM after its ready signal",
		async () => {
			const root = fixture();
			const readyPath = join(root, "ready");
			const watcher = watch(root);
			const ready = new Promise((accept) =>
				watcher.on("change", (_event, name) => {
					if (name === "ready") accept();
				})
			);
			const controller = new AbortController();
			const pending = runCommand(
				process.execPath,
				[
					"-e",
					"process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], 'ready'); setInterval(() => {}, 1000);",
					readyPath,
				],
				{ signal: controller.signal }
			);
			await ready;
			watcher.close();
			controller.abort();
			await expect(pending).rejects.toThrow(/cancelled/u);
		}
	);
});
