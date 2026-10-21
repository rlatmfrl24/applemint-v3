import { withVerificationDatabase } from "./isolated-database.mjs";

try {
	await withVerificationDatabase((database) => database.supabase(["test", "db", "--local"]));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
