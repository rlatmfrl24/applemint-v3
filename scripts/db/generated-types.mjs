import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SUPABASE_CLI_VERSION = "2.109.1";
const OUTPUT_PATH = resolve("types/database.types.ts");
const GENERATED_HELPERS_MARKER = "\ntype DatabaseWithoutInternals";

function runSupabase(args) {
	const result = spawnSync("supabase", args, {
		cwd: process.cwd(),
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || `supabase ${args.join(" ")} failed.`);
	}
	return result.stdout.trimEnd().replace(/\r\n/gu, "\n");
}

function assertCliVersion() {
	const version = runSupabase(["--version"]);
	if (version !== SUPABASE_CLI_VERSION) {
		throw new Error(
			`Supabase CLI ${SUPABASE_CLI_VERSION}가 필요합니다. 현재 버전: ${version || "unknown"}.`
		);
	}
}

function formatGeneratedTypes(source) {
	const biomeEntrypoint = resolve("node_modules/@biomejs/biome/bin/biome");
	const result = spawnSync(
		process.execPath,
		[biomeEntrypoint, "format", "--stdin-file-path", OUTPUT_PATH],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			input: source,
		}
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || "Biome could not format generated database types.");
	}
	return result.stdout.replace(/\r\n/gu, "\n");
}

function generateTypes() {
	assertCliVersion();
	const rawTypes = runSupabase(["gen", "types", "typescript", "--local", "--schema", "public"]);
	const helpersStart = rawTypes.indexOf(GENERATED_HELPERS_MARKER);
	const applicationTypes = helpersStart === -1 ? rawTypes : rawTypes.slice(0, helpersStart);
	return formatGeneratedTypes(`${applicationTypes}\n`);
}

function main() {
	const mode = process.argv[2];
	if (mode !== "--write" && mode !== "--check") {
		throw new Error("Use --write or --check.");
	}

	const generated = generateTypes();
	if (mode === "--write") {
		mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
		writeFileSync(OUTPUT_PATH, generated, "utf8");
		console.log(`Generated ${OUTPUT_PATH}`);
		return;
	}

	const current = readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/gu, "\n");
	if (current !== generated) {
		throw new Error(
			"Supabase 생성 타입이 로컬 DB와 다릅니다. pnpm db:types:generate를 실행하세요."
		);
	}
	console.log(`Supabase generated types drift check: PASS (${SUPABASE_CLI_VERSION})`);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
