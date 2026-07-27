import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PROJECT_ID = "applemint-v3";
const OWNER_EMAIL = "e2e-owner@applemint.local";
const BASE_URL = "http://localhost:3100";
const RUNTIME_PATH = resolve("playwright/.auth/runtime.json");
const SUPABASE_START_ARGS = [
	"start",
	"--ignore-health-check",
	"--exclude",
	"edge-runtime,imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector",
];

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		cwd: process.cwd(),
		encoding: "utf8",
		...options,
	});
}

function parseEnvOutput(output) {
	const values = new Map();
	for (const line of output.split(/\r?\n/u)) {
		const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/u);
		if (match) {
			values.set(match[1], match[2] ?? match[3] ?? "");
		}
	}
	return values;
}

function requireValue(values, ...keys) {
	for (const key of keys) {
		const value = values.get(key);
		if (value) return value;
	}
	throw new Error(`로컬 Supabase 상태에서 ${keys.join(" 또는 ")} 값을 찾지 못했습니다.`);
}

function assertLoopbackUrl(value, expectedPort, label) {
	const url = new URL(value);
	if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== expectedPort) {
		throw new Error(`${label}이 로컬 전용 주소가 아닙니다: ${url.origin}`);
	}
}

function normalizeLocalApiUrl(value) {
	const url = new URL(value);
	url.hostname = "localhost";
	return url.origin;
}

async function waitForLocalApi(apiUrl) {
	let lastError;
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			const response = await fetch(`${apiUrl}/auth/v1/health`, {
				signal: AbortSignal.timeout(2000),
			});
			if (response.ok) return;
			lastError = new Error(`Auth health 응답 상태: ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
	}
	throw new Error(
		`로컬 Supabase Auth API가 준비되지 않았습니다. (${lastError instanceof Error ? lastError.message : String(lastError)})`
	);
}

function appendGitHubEnv(entries) {
	const githubEnv = process.env.GITHUB_ENV;
	if (!githubEnv) return;

	const content = Object.entries(entries)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
	writeFileSync(githubEnv, `${content}\n`, { flag: "a", encoding: "utf8" });
}

function readOwnerId(containerId) {
	const ownerId = run("docker", [
		"exec",
		containerId,
		"psql",
		"-At",
		"-U",
		"postgres",
		"-d",
		"postgres",
		"-c",
		"select (regexp_match(pg_get_functiondef('public.is_applemint_owner()'::regprocedure), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))[1];",
	]).trim();

	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(ownerId)) {
		throw new Error("is_applemint_owner() 함수에서 소유자 UUID를 확인할 수 없습니다.");
	}
	return ownerId;
}

function createOwner(containerId, ownerId, password) {
	const sql = `
begin;

delete from auth.identities where user_id = '${ownerId}'::uuid;
delete from auth.users where id = '${ownerId}'::uuid;

insert into auth.users (
	instance_id,
	id,
	aud,
	role,
	email,
	encrypted_password,
	email_confirmed_at,
	raw_app_meta_data,
	raw_user_meta_data,
	created_at,
	updated_at,
	confirmation_token,
	recovery_token,
	email_change_token_new,
	email_change
)
values (
	'00000000-0000-0000-0000-000000000000'::uuid,
	'${ownerId}'::uuid,
	'authenticated',
	'authenticated',
	'${OWNER_EMAIL}',
	extensions.crypt('${password}', extensions.gen_salt('bf')),
	now(),
	'{"provider":"email","providers":["email"]}'::jsonb,
	'{}'::jsonb,
	now(),
	now(),
	'',
	'',
	'',
	''
);

insert into auth.identities (
	provider_id,
	user_id,
	identity_data,
	provider,
	last_sign_in_at,
	created_at,
	updated_at,
	id
)
values (
	'${ownerId}',
	'${ownerId}'::uuid,
	jsonb_build_object(
		'sub', '${ownerId}',
		'email', '${OWNER_EMAIL}',
		'email_verified', true,
		'phone_verified', false
	),
	'email',
	now(),
	now(),
	now(),
	gen_random_uuid()
);

commit;
`;

	const result = spawnSync(
		"docker",
		[
			"exec",
			"-i",
			containerId,
			"psql",
			"-v",
			"ON_ERROR_STOP=1",
			"-U",
			"postgres",
			"-d",
			"postgres",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			input: sql,
			stdio: ["pipe", "ignore", "pipe"],
		}
	);

	if (result.status !== 0) {
		throw new Error(`로컬 E2E 소유자 생성에 실패했습니다.\n${result.stderr ?? ""}`);
	}
}

function findLocalDatabaseContainers() {
	return run("docker", [
		"ps",
		"--filter",
		`label=com.supabase.cli.project=${PROJECT_ID}`,
		"--filter",
		"name=supabase_db_",
		"--format",
		"{{.ID}}",
	])
		.trim()
		.split(/\r?\n/u)
		.filter(Boolean);
}

function isLocalEmailProviderEnabled() {
	const authContainers = run("docker", [
		"ps",
		"--filter",
		`label=com.supabase.cli.project=${PROJECT_ID}`,
		"--filter",
		"name=supabase_auth_",
		"--format",
		"{{.ID}}",
	])
		.trim()
		.split(/\r?\n/u)
		.filter(Boolean);

	if (authContainers.length !== 1) return false;
	const environment = JSON.parse(
		run("docker", ["inspect", authContainers[0], "--format", "{{json .Config.Env}}"])
	);
	return environment.includes("GOTRUE_EXTERNAL_EMAIL_ENABLED=true");
}

function assertSingleLocalDatabase(status) {
	const dbUrl = requireValue(status, "DB_URL");
	assertLoopbackUrl(dbUrl, "54322", "Supabase DB URL");

	const containers = findLocalDatabaseContainers();
	if (containers.length !== 1) {
		throw new Error(
			`로컬 Supabase DB 컨테이너를 하나만 찾을 수 있어야 합니다. 발견: ${containers.length}`
		);
	}
	return containers[0];
}

async function main() {
	console.log("로컬 Supabase E2E 서비스를 준비합니다...");
	run("supabase", SUPABASE_START_ARGS, { stdio: ["ignore", "ignore", "inherit"] });
	let status = parseEnvOutput(run("supabase", ["status", "-o", "env"]));
	if (!status.get("API_URL") || !isLocalEmailProviderEnabled()) {
		assertSingleLocalDatabase(status);
		console.log("로컬 Supabase 서비스 또는 Auth 설정 변경을 감지해 스택을 재시작합니다...");
		run("supabase", ["stop", "--no-backup"], {
			stdio: ["ignore", "ignore", "inherit"],
		});
		run("supabase", SUPABASE_START_ARGS, { stdio: ["ignore", "ignore", "inherit"] });
	}
	run("supabase", ["db", "reset", "--local", "--yes"], {
		stdio: ["ignore", "ignore", "inherit"],
	});

	status = parseEnvOutput(run("supabase", ["status", "-o", "env"]));
	const reportedApiUrl = requireValue(status, "API_URL");
	const dbUrl = requireValue(status, "DB_URL");
	const publishableKey = requireValue(status, "PUBLISHABLE_KEY");
	const secretKey = requireValue(status, "SECRET_KEY");

	assertLoopbackUrl(reportedApiUrl, "54321", "Supabase API URL");
	assertLoopbackUrl(dbUrl, "54322", "Supabase DB URL");
	const apiUrl = normalizeLocalApiUrl(reportedApiUrl);
	await waitForLocalApi(apiUrl);

	const databaseContainer = assertSingleLocalDatabase(status);

	const ownerPassword = randomBytes(32).toString("base64url");
	const internalSecret = randomBytes(32).toString("base64url");
	const ownerId = readOwnerId(databaseContainer);
	createOwner(databaseContainer, ownerId, ownerPassword);

	const runtime = {
		baseUrl: BASE_URL,
		supabaseUrl: apiUrl,
		publishableKey,
		secretKey,
		internalSecret,
		ownerEmail: OWNER_EMAIL,
		ownerPassword,
	};

	mkdirSync(dirname(RUNTIME_PATH), { recursive: true });
	writeFileSync(RUNTIME_PATH, `${JSON.stringify(runtime, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	try {
		chmodSync(RUNTIME_PATH, 0o600);
	} catch {
		// Windows에서는 POSIX 파일 권한 변경이 적용되지 않을 수 있습니다.
	}

	appendGitHubEnv({
		NEXT_PUBLIC_SUPABASE_URL: apiUrl,
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
		SUPABASE_URL: apiUrl,
		SUPABASE_SECRET_KEY: secretKey,
		CRAWL_INTERNAL_SECRET: internalSecret,
	});

	console.log("로컬 E2E 소유자와 실행 환경 준비를 완료했습니다.");
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
