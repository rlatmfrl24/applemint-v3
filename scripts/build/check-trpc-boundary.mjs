import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const TRACE_PATH = resolve(".next/server/app/api/trpc/[trpc]/route.js.nft.json");
const FORBIDDEN_PATHS = [
	`${sep}node_modules${sep}web-push${sep}`,
	`${sep}utils${sep}supabase${sep}service-role`,
];
const FORBIDDEN_BUNDLE_MARKERS = [
	"SUPABASE_SECRET_KEY",
	"createServiceRoleClient",
	"sendWebPushTest",
	"server_push_test-sender",
	"utils_supabase_service-role",
];

function normalizePath(value) {
	return value.replaceAll("/", sep).replaceAll("\\", sep);
}

const trace = JSON.parse(readFileSync(TRACE_PATH, "utf8"));
if (!Array.isArray(trace.files)) {
	throw new Error("The tRPC build trace does not contain a files array.");
}

const tracedFiles = trace.files.map((file) => resolve(dirname(TRACE_PATH), file));
const violations = tracedFiles.filter((file) =>
	FORBIDDEN_PATHS.some((forbidden) => normalizePath(file).includes(forbidden))
);
for (const file of tracedFiles.filter((value) => value.endsWith(".js"))) {
	const source = readFileSync(file, "utf8");
	for (const marker of FORBIDDEN_BUNDLE_MARKERS) {
		if (source.includes(marker)) violations.push(`${file} (contains ${marker})`);
	}
}

if (violations.length > 0) {
	throw new Error(`General tRPC trace crossed a server-only boundary:\n${violations.join("\n")}`);
}

console.log(`General tRPC server-only trace boundary: PASS (${tracedFiles.length} files)`);
