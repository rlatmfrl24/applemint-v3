import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_VERSION = "2.109.1";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OWNER_LABEL = "com.applemint.database-verification.owner";
const PROJECT_PATTERN = /^am-db-[a-f0-9]{32}$/u;

export function runCommand(command, args, options = {}) {
	return new Promise((accept, reject) => {
		if (options.signal?.aborted) {
			reject(new Error("Verification command cancelled."));
			return;
		}
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			detached: process.platform !== "win32" && Boolean(options.signal),
			windowsHide: true,
			stdio: ["ignore", options.capture ? "pipe" : "inherit", "inherit"],
		});
		let aborted = false;
		let spawnError;
		let killTimer;
		let termination = Promise.resolve();
		const abort = () => {
			aborted = true;
			if (!child.pid) return;
			if (process.platform === "win32") {
				// Kill only this spawned process tree, including pnpm/CLI grandchildren.
				termination = new Promise((done) => {
					const killer = spawn("taskkill", ["/pid", `${child.pid}`, "/T", "/F"], {
						windowsHide: true,
						stdio: "ignore",
						timeout: 1000,
					});
					killer.on("error", () => {
						child.kill();
						done();
					});
					killer.on("close", (status) => {
						if (status !== 0) child.kill();
						done();
					});
				});
			} else {
				try {
					process.kill(-child.pid, "SIGTERM");
				} catch {
					child.kill();
				}
				killTimer = setTimeout(() => {
					try {
						process.kill(-child.pid, "SIGKILL");
					} catch {
						child.kill("SIGKILL");
					}
				}, 500);
			}
		};
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) abort();
		let stdout = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("error", (error) => {
			spawnError = error;
		});
		child.on("close", async (status, signal) => {
			clearTimeout(killTimer);
			options.signal?.removeEventListener("abort", abort);
			await termination;
			if (spawnError || aborted) reject(spawnError ?? new Error("Verification command cancelled."));
			else if (status !== 0 && !options.allowFailure) {
				reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? status}).`));
			} else accept({ status, stdout });
		});
	});
}

async function unusedPorts() {
	const servers = [];
	try {
		for (let index = 0; index < 2; index++) {
			const server = createServer();
			await new Promise((accept, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", accept);
			});
			servers.push(server);
		}
		return servers.map((server) => server.address().port);
	} finally {
		await Promise.all(servers.map((server) => new Promise((accept) => server.close(accept))));
	}
}

function readOwner(workdir, owner, root) {
	try {
		const marker = JSON.parse(readFileSync(join(workdir, "owner.json"), "utf8"));
		const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
		if (
			!owner ||
			marker.owner !== owner ||
			!PROJECT_PATTERN.test(marker.project) ||
			marker.network !== `${marker.project}-loopback` ||
			marker.root !== realpathSync(root) ||
			realpathSync(workdir) !== marker.workdir ||
			!basename(workdir).startsWith("applemint-db-verify-") ||
			!config.includes(`project_id = "${marker.project}"`) ||
			!Number.isInteger(marker.port) ||
			marker.port < 1024 ||
			marker.port > 65535
		)
			throw new Error("invalid marker");
		return marker;
	} catch {
		throw new Error(`Database verification ownership check failed: ${workdir}`);
	}
}

function context(marker, run, env, signal) {
	const childEnv = {
		...env,
		APPLEMINT_VERIFY_DB_WORKDIR: marker.workdir,
		APPLEMINT_VERIFY_DB_OWNER: marker.owner,
	};
	return {
		...marker,
		env: childEnv,
		signal,
		async supabase(args, options = {}) {
			readOwner(marker.workdir, marker.owner, marker.root);
			return run(
				env.APPLEMINT_SUPABASE_BIN || "supabase",
				[...args, "--workdir", marker.workdir, "--network-id", marker.network],
				{
					cwd: marker.workdir,
					env: { ...childEnv, SUPABASE_WORKDIR: marker.workdir },
					signal,
					...options,
				}
			);
		},
	};
}

async function ownedNetwork(marker, run, env, allowMissing = false) {
	const result = await run("docker", ["network", "inspect", marker.network], {
		cwd: marker.workdir,
		env,
		capture: true,
		allowFailure: allowMissing,
	});
	if (allowMissing && result.status !== 0) return;
	const network = JSON.parse(result.stdout)[0];
	if (network?.Name !== marker.network || network.Labels?.[OWNER_LABEL] !== marker.owner) {
		throw new Error(`Database verification network ownership check failed: ${marker.network}`);
	}
	return network;
}

async function inspectOwnedDatabase(marker, run, env) {
	await ownedNetwork(marker, run, env);
	const result = await run("docker", ["inspect", `supabase_db_${marker.project}`], {
		cwd: marker.workdir,
		env,
		capture: true,
	});
	const database = JSON.parse(result.stdout)[0];
	const aliases = database?.NetworkSettings?.Networks?.[marker.network]?.Aliases ?? [];
	if (
		database?.Name !== `/supabase_db_${marker.project}` ||
		database.Config?.Labels?.["com.supabase.cli.project"] !== marker.project ||
		!aliases.includes("db")
	)
		throw new Error(`Database verification ownership check failed: ${marker.project}`);
	return database;
}

function isLoopback(database, marker) {
	const bindings = database.NetworkSettings?.Ports?.["5432/tcp"];
	return (
		bindings?.length === 1 &&
		bindings[0].HostIp === "127.0.0.1" &&
		bindings[0].HostPort === `${marker.port}`
	);
}

async function assertDatabase(marker, run, env) {
	const database = await inspectOwnedDatabase(marker, run, env);
	if (!isLoopback(database, marker))
		throw new Error(`Database verification isolation check failed: ${marker.project}`);
}

function healthArguments(health) {
	const args = [];
	if (health?.Test?.[0] === "NONE") args.push("--no-healthcheck");
	else if (health?.Test?.length) {
		const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
		const command =
			health.Test[0] === "CMD" ? health.Test.slice(1).map(shellQuote).join(" ") : health.Test[1];
		args.push("--health-cmd", command);
		for (const [key, flag] of [
			["Interval", "interval"],
			["Timeout", "timeout"],
			["StartPeriod", "start-period"],
			["StartInterval", "start-interval"],
		]) {
			if (health[key]) args.push(`--health-${flag}`, `${health[key]}ns`);
		}
		if (health.Retries) args.push("--health-retries", `${health.Retries}`);
	}
	return args;
}

function recreateArguments(database, marker) {
	const config = database.Config;
	const args = [
		"create",
		"--name",
		database.Name.slice(1),
		"--network",
		marker.network,
		"--network-alias",
		"db",
		"--network-alias",
		"db.supabase.internal",
		"--publish",
		`127.0.0.1:${marker.port}:5432`,
		"--restart",
		"no",
	];
	for (const [key, value] of Object.entries(config.Labels ?? {}))
		args.push("--label", `${key}=${value}`);
	for (const value of config.Env) args.push("--env", value);
	for (const value of database.HostConfig.Binds) args.push("--volume", value);
	for (const value of database.HostConfig.ExtraHosts ?? []) args.push("--add-host", value);
	for (const [path, value] of Object.entries(database.HostConfig.Tmpfs ?? {}))
		args.push("--tmpfs", `${path}:${value}`);
	if (config.User) args.push("--user", config.User);
	if (config.WorkingDir) args.push("--workdir", config.WorkingDir);
	if (config.StopSignal) args.push("--stop-signal", config.StopSignal);
	if (database.HostConfig.ShmSize) args.push("--shm-size", `${database.HostConfig.ShmSize}`);
	args.push(...healthArguments(config.Healthcheck));
	if (config.Entrypoint?.length) args.push("--entrypoint", config.Entrypoint[0]);
	args.push(config.Image, ...(config.Entrypoint?.slice(1) ?? []), ...(config.Cmd ?? []));
	return args;
}

async function ensureLoopbackDatabase(marker, run, env, signal) {
	const database = await inspectOwnedDatabase(marker, run, env);
	if (isLoopback(database, marker)) return;
	// Docker Desktop can ignore bridge host_binding_ipv4. Recreate only this empty
	// verification fixture with an explicit binding, preserving its owned data volume.
	const name = database.Name.slice(1);
	if (
		database.HostConfig.Binds?.length !== 1 ||
		![`${name}:/var/lib/postgresql/data`, `${name}:/var/lib/postgresql/data:rw`].includes(
			database.HostConfig.Binds[0]
		)
	) {
		throw new Error(`Verification volume ownership check failed: ${name}`);
	}
	const volume = JSON.parse(
		(await run("docker", ["volume", "inspect", name], { cwd: marker.workdir, env, capture: true }))
			.stdout
	)[0];
	if (volume.Name !== name || volume.Labels?.["com.supabase.cli.project"] !== marker.project)
		throw new Error(`Verification volume ownership check failed: ${name}`);
	const options = { cwd: marker.workdir, env, signal };
	console.log("Rebinding the disposable Docker Desktop database to 127.0.0.1.");
	await run("docker", ["stop", name], options);
	await run("docker", ["rm", name], options);
	await run("docker", recreateArguments(database, marker), options);
	await run("docker", ["start", name], options);
	await run(
		"docker",
		[
			"exec",
			name,
			"sh",
			"-c",
			"for attempt in $(seq 1 60); do pg_isready -U postgres -h 127.0.0.1 -p 5432 && exit 0; sleep 1; done; exit 1",
		],
		options
	);
}

async function createWorkspace(root) {
	const workdir = realpathSync(mkdtempSync(join(tmpdir(), "applemint-db-verify-")));
	try {
		const owner = randomUUID().replaceAll("-", "");
		// CLI project IDs are limited to 40 characters; keep the complete UUID.
		const project = `am-db-${owner}`;
		const [port, shadowPort] = await unusedPorts();
		const marker = {
			workdir,
			root: realpathSync(root),
			owner,
			project,
			network: `${project}-loopback`,
			port,
		};
		for (const name of ["migrations", "tests", "seed.sql", "config.toml"]) {
			cpSync(join(root, "supabase", name), join(workdir, "supabase", name), { recursive: true });
		}
		const configPath = join(workdir, "supabase", "config.toml");
		const config = readFileSync(configPath, "utf8")
			.replace(/^project_id\s*=.*$/mu, `project_id = "${project}"`)
			.replace(/(\[db\][\s\S]*?^port\s*=)\s*\d+/mu, `$1 ${port}`)
			.replace(/(^shadow_port\s*=)\s*\d+/mu, `$1 ${shadowPort}`);
		writeFileSync(configPath, config);
		writeFileSync(join(workdir, "owner.json"), JSON.stringify(marker));
		readOwner(workdir, owner, root);
		return marker;
	} catch (error) {
		rmSync(workdir, { recursive: true, force: true });
		throw error;
	}
}

async function assertUnusedProject(marker, run, env) {
	for (const args of [
		["ps", "-aq", "--filter", `label=com.supabase.cli.project=${marker.project}`],
		["volume", "ls", "-q", "--filter", `label=com.supabase.cli.project=${marker.project}`],
	]) {
		const result = await run("docker", args, { cwd: marker.workdir, env, capture: true });
		if (result.stdout.trim())
			throw new Error(`Verification project already exists: ${marker.project}`);
	}
}

export async function withVerificationDatabase(
	task,
	{ root = ROOT, run = runCommand, env = process.env } = {}
) {
	if (env.APPLEMINT_VERIFY_DB_WORKDIR || env.APPLEMINT_VERIFY_DB_OWNER) {
		const marker = readOwner(env.APPLEMINT_VERIFY_DB_WORKDIR, env.APPLEMINT_VERIFY_DB_OWNER, root);
		await assertDatabase(marker, run, env);
		return task(context(marker, run, env));
	}
	const version = await run(env.APPLEMINT_SUPABASE_BIN || "supabase", ["--version"], {
		cwd: tmpdir(),
		env: { ...env, SUPABASE_WORKDIR: tmpdir() },
		capture: true,
	});
	if (version.stdout.trim() !== CLI_VERSION) {
		throw new Error(
			`Supabase CLI ${CLI_VERSION} is required (found ${version.stdout.trim() || "unknown"}). Set APPLEMINT_SUPABASE_BIN to the pinned executable if needed.`
		);
	}
	const marker = await createWorkspace(root);
	const controller = new AbortController();
	const interrupted = () => controller.abort();
	process.once("SIGINT", interrupted);
	process.once("SIGTERM", interrupted);
	let ownsNetwork = false;
	let starting = false;
	let failure;
	let value;
	try {
		await assertUnusedProject(marker, run, env);
		await run(
			"docker",
			[
				"network",
				"create",
				"--driver",
				"bridge",
				"--label",
				`${OWNER_LABEL}=${marker.owner}`,
				"--opt",
				"com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
				marker.network,
			],
			{ cwd: marker.workdir, env }
		);
		ownsNetwork = true;
		await ownedNetwork(marker, run, env);
		starting = true;
		const database = context(marker, run, env, controller.signal);
		console.log(`Disposable Supabase verification: ${marker.project} (127.0.0.1:${marker.port})`);
		await database.supabase(["db", "start"]);
		await ensureLoopbackDatabase(marker, run, env, controller.signal);
		await assertDatabase(marker, run, env);
		value = await task(database);
	} catch (error) {
		failure = error;
	} finally {
		try {
			readOwner(marker.workdir, marker.owner, root);
			if (ownsNetwork) {
				await ownedNetwork(marker, run, env);
				if (starting)
					await context(marker, run, env).supabase([
						"stop",
						"--project-id",
						marker.project,
						"--no-backup",
					]);
				const network = await ownedNetwork(marker, run, env, true);
				if (network)
					await run("docker", ["network", "rm", network.Id], { cwd: marker.workdir, env });
			}
			rmSync(marker.workdir, { recursive: true, force: true });
		} catch (cleanupError) {
			failure = new AggregateError(
				[failure, cleanupError].filter(Boolean),
				`Verification cleanup failed; owned workspace retained at ${marker.workdir}. ${cleanupError.message}`
			);
		} finally {
			process.removeListener("SIGINT", interrupted);
			process.removeListener("SIGTERM", interrupted);
		}
	}
	if (failure) throw failure;
	return value;
}

export async function runPnpm(args, database) {
	const entrypoint = process.env.npm_execpath;
	if (!entrypoint) throw new Error("Run verification through pnpm.");
	return runCommand(process.execPath, [entrypoint, ...args], {
		cwd: resolve(database.root),
		env: database.env,
		signal: database.signal,
	});
}
