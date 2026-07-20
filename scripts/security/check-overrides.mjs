import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateOverrideRegistry } from "./override-policy.mjs";

async function readJson(path) {
	return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main() {
	const packageJson = await readJson("package.json");
	const registry = await readJson("security/package-overrides.json");
	const result = validateOverrideRegistry(packageJson, registry);

	if (!result.valid) {
		for (const error of result.errors) {
			console.error(`::error::${error}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log(`Package override registry is valid. Overrides: ${result.overrideCount}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
