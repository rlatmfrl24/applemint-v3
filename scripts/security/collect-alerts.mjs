import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	countBySeverity,
	dedupeByAlertNumber,
	detectRepository,
	detectToken,
	fetchAndNormalizeAlerts,
} from "./github-alerts.mjs";

function parseArgs(argv) {
	const args = { repo: null, out: "reports/security/alerts-normalized.json" };

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--repo") {
			args.repo = argv[index + 1] ?? null;
			index += 1;
			continue;
		}
		if (token === "--out") {
			args.out = argv[index + 1] ?? args.out;
			index += 1;
		}
	}

	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const repo = detectRepository(args.repo);
	const token = detectToken();

	const snapshot = await fetchAndNormalizeAlerts({ repo, token });
	const uniqueAlerts = dedupeByAlertNumber(snapshot.normalized_alerts).alerts;
	const severity = countBySeverity(uniqueAlerts);
	const outputPath = resolve(args.out);

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, JSON.stringify(snapshot, null, 2), "utf8");

	console.log(`Repository: ${repo}`);
	console.log(`Output: ${outputPath}`);
	console.log(`Raw alerts: ${snapshot.dedup.alert_count_raw}`);
	console.log(`Unique alerts (number): ${snapshot.dedup.alert_count_unique_by_number}`);
	console.log(
		`Unique advisories (ghsa+package): ${snapshot.dedup.advisory_count_unique_ghsa_package}`
	);
	console.log(
		`Severity (unique): critical=${severity.critical}, high=${severity.high}, medium=${severity.medium}, low=${severity.low}, unknown=${severity.unknown}`
	);

	for (const [source, status] of Object.entries(snapshot.sources)) {
		const reasonSuffix = status.reason ? ` (${status.reason})` : "";
		console.log(
			`Source ${source}: status=${status.status}, total=${status.total_alerts}${reasonSuffix}`
		);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
