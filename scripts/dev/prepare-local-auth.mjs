import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PROJECT_ID = "applemint-v3";
const OWNER_EMAIL = "local-owner@applemint.local";
const RUNTIME_PATH = resolve("playwright/.auth/local-dev.json");

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

function findLocalDatabaseContainer() {
	const containers = run("docker", [
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

	if (containers.length !== 1) {
		throw new Error(
			`로컬 Supabase DB 컨테이너를 하나만 찾을 수 있어야 합니다. 발견: ${containers.length}`
		);
	}
	return containers[0];
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

function ownerExists(containerId, ownerId) {
	return (
		run("docker", [
			"exec",
			containerId,
			"psql",
			"-At",
			"-U",
			"postgres",
			"-d",
			"postgres",
			"-c",
			`select exists(select 1 from auth.users where id = '${ownerId}'::uuid);`,
		]).trim() === "t"
	);
}

function createOwner(containerId, ownerId, password) {
	const sql = `
begin;

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
		throw new Error(`로컬 소유자 생성에 실패했습니다.\n${result.stderr ?? ""}`);
	}
}

async function verifyCredentials(runtime) {
	const response = await fetch(`${runtime.supabaseUrl}/auth/v1/token?grant_type=password`, {
		method: "POST",
		headers: {
			apikey: runtime.publishableKey,
			authorization: `Bearer ${runtime.publishableKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			email: runtime.ownerEmail,
			password: runtime.ownerPassword,
		}),
		signal: AbortSignal.timeout(5_000),
	});
	return response.ok;
}

function readExistingRuntime() {
	try {
		return JSON.parse(readFileSync(RUNTIME_PATH, "utf8"));
	} catch {
		return null;
	}
}

function writeRuntime(runtime) {
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
}

async function main() {
	const status = parseEnvOutput(run("supabase", ["status", "-o", "env"]));
	const reportedApiUrl = requireValue(status, "API_URL");
	const dbUrl = requireValue(status, "DB_URL");
	const publishableKey = requireValue(status, "PUBLISHABLE_KEY");
	const secretKey = requireValue(status, "SECRET_KEY");

	assertLoopbackUrl(reportedApiUrl, "54321", "Supabase API URL");
	assertLoopbackUrl(dbUrl, "54322", "Supabase DB URL");

	const supabaseUrl = normalizeLocalApiUrl(reportedApiUrl);
	const databaseContainer = findLocalDatabaseContainer();
	const ownerId = readOwnerId(databaseContainer);
	const existingRuntime = readExistingRuntime();

	if (ownerExists(databaseContainer, ownerId)) {
		if (existingRuntime && (await verifyCredentials(existingRuntime))) {
			console.log(`로컬 소유자 인증이 준비되어 있습니다: ${RUNTIME_PATH}`);
			return;
		}
		throw new Error(
			"로컬 소유자 계정은 있지만 저장된 개발용 인증 정보가 없거나 유효하지 않습니다. 기존 계정을 덮어쓰지 않았습니다."
		);
	}

	const ownerPassword = randomBytes(32).toString("base64url");
	const runtime = {
		supabaseUrl,
		publishableKey,
		secretKey,
		internalSecret: randomBytes(32).toString("base64url"),
		ownerEmail: OWNER_EMAIL,
		ownerPassword,
	};

	createOwner(databaseContainer, ownerId, ownerPassword);
	if (!(await verifyCredentials(runtime))) {
		throw new Error("로컬 소유자 계정 생성 후 로그인 검증에 실패했습니다.");
	}
	writeRuntime(runtime);

	console.log(`로컬 소유자 인증을 준비했습니다: ${RUNTIME_PATH}`);
	console.log(`이메일: ${OWNER_EMAIL}`);
	console.log("비밀번호는 위 로컬 전용 인증 파일에 저장했습니다.");
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
