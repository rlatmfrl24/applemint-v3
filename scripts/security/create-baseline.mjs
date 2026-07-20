import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { detectRepository, detectToken, fetchAndNormalizeAlerts } from "./github-alerts.mjs";
import { createAlertBaseline } from "./security-policy.mjs";

function parseArgs(argv) {
	const args = { repo: null, out: "security/alert-baseline.json" };
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--repo") {
			args.repo = argv[index + 1] ?? null;
			index += 1;
		} else if (argv[index] === "--out") {
			args.out = argv[index + 1] ?? args.out;
			index += 1;
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const repository = detectRepository(args.repo);
	const snapshot = await fetchAndNormalizeAlerts({
		repo: repository,
		token: detectToken(),
	});
	const baseline = createAlertBaseline(snapshot.normalized_alerts);
	const outputPath = resolve(args.out);

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
	console.log(`Security alert baseline written: ${outputPath}`);
	console.log(`Baseline alerts: ${baseline.alerts.length}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
