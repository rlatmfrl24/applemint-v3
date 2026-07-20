import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { detectRepository, detectToken, fetchAndNormalizeAlerts } from "./github-alerts.mjs";
import { buildCollectionFailureResult, buildSecurityGateResult } from "./security-policy.mjs";

function parseArgs(argv) {
	const args = {
		repo: null,
		baseline: "security/alert-baseline.json",
		out: "reports/security/security-gate-result.json",
	};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--repo") {
			args.repo = argv[index + 1] ?? null;
			index += 1;
		} else if (token === "--baseline") {
			args.baseline = argv[index + 1] ?? args.baseline;
			index += 1;
		} else if (token === "--out") {
			args.out = argv[index + 1] ?? args.out;
			index += 1;
		}
	}

	return args;
}

function buildStepSummary(result) {
	const disabledSources =
		result.disabled_sources.length > 0 ? result.disabled_sources.join(", ") : "none";
	const status = result.blocking_alert_count > 0 ? "FAIL" : "PASS";

	return [
		"## Security Gate",
		`- Repository: \`${result.repository}\``,
		`- Policy: \`${result.policy}\``,
		`- Current / baseline alerts: **${result.current_alert_count} / ${result.baseline_alert_count}**`,
		`- New / resolved alerts: **${result.new_alerts.length} / ${result.resolved_alerts.length}**`,
		`- Severity: critical=${result.severity.critical}, high=${result.severity.high}, medium=${result.severity.medium}, low=${result.severity.low}, unknown=${result.severity.unknown}`,
		`- High/critical gate: **${status}** (count=${result.blocking_alert_count})`,
		`- Disabled sources: ${disabledSources}`,
		result.collection_error ? `- Collection error: ${result.collection_error}` : null,
	]
		.filter(Boolean)
		.join("\n");
}

async function writeResult(outputPath, result) {
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(process.env.GITHUB_STEP_SUMMARY, `${buildStepSummary(result)}\n`, "utf8");
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const outputPath = resolve(args.out);
	let repository = args.repo ?? process.env.GITHUB_REPOSITORY ?? "unknown/unknown";
	let result;

	try {
		repository = detectRepository(args.repo);
		const baseline = JSON.parse(await readFile(resolve(args.baseline), "utf8"));
		const snapshot = await fetchAndNormalizeAlerts({ repo: repository, token: detectToken() });
		result = buildSecurityGateResult({ repository, snapshot, baseline });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result = buildCollectionFailureResult(repository, message);
	}

	await writeResult(outputPath, result);
	console.log(buildStepSummary(result));
	console.log(`Security gate output: ${outputPath}`);

	if (result.severity.medium > 0 || result.new_alerts.length > 0) {
		console.log(
			`::warning::Security gate found ${result.new_alerts.length} new alert(s) and ${result.severity.medium} medium alert(s).`
		);
	}
	if (result.blocking_alert_count > 0) {
		console.error(
			result.collection_error
				? `::error::Security gate collection failed: ${result.collection_error}`
				: `::error::Security gate blocked ${result.blocking_alert_count} high/critical alert(s).`
		);
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
