import { runPnpm, withVerificationDatabase } from "./isolated-database.mjs";

try {
	await withVerificationDatabase(async (database) => {
		await runPnpm(["exec", "biome", "check", ".", "--error-on-warnings"], database);
		for (const script of ["deadcode", "db:types:check", "test:coverage", "test:db", "build"]) {
			await runPnpm(["run", script], database);
		}
	});
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
