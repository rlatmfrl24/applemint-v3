import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	countBySeverity,
	detectRepository,
	detectToken,
	dedupeByAlertNumber,
	fetchAndNormalizeAlerts,
} from "./github-alerts.mjs";

function parseArgs(argv) {
	const args = { repo: null, out: "reports/security/security-gate-result.json" };

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

function buildStepSummary(result) {
	const disabledSources = Object.entries(result.sources)
		.filter(([, status]) => status.status === "disabled")
		.map(([name]) => name);
	const disabledLine =
		disabledSources.length > 0 ? disabledSources.join(", ") : "none";

	return [
		"## Security Gate",
		`- Repository: \`${result.repository}\``,
		`- Unique open alerts: **${result.total_unique_alerts}**`,
		`- Severity: critical=${result.severity.critical}, high=${result.severity.high}, medium=${result.severity.medium}, low=${result.severity.low}, unknown=${result.severity.unknown}`,
		`- Disabled sources: ${disabledLine}`,
		`- High threshold result: ${
			result.blocking_high_count > 0 ? "FAIL" : "PASS"
		} (count=${result.blocking_high_count})`,
		result.collection_error
			? `- Collection error: ${result.collection_error}`
			: null,
	]
		.filter(Boolean)
		.join("\n");
}

async function writeStepSummary(markdown) {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (!summaryPath) {
		return;
	}
	await writeFile(summaryPath, `${markdown}\n`, "utf8");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const outputPath = resolve(args.out);
	let repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? "unknown/unknown";

	try {
		repo = detectRepository(args.repo);
		const token = detectToken();
		const snapshot = await fetchAndNormalizeAlerts({ repo, token });
		const dedupByNumber = dedupeByAlertNumber(snapshot.normalized_alerts);
		const severity = countBySeverity(dedupByNumber.alerts);
		const blockingHighCount = severity.critical + severity.high;

		const result = {
			repository: repo,
			generated_at: snapshot.generated_at,
			total_unique_alerts: dedupByNumber.alerts.length,
			blocking_high_count: blockingHighCount,
			medium_count: severity.medium,
			severity,
			sources: snapshot.sources,
			disabled_sources: Object.entries(snapshot.sources)
				.filter(([, status]) => status.status === "disabled")
				.map(([name]) => name),
			collection_error: null,
		};

		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

		console.log(`Repository: ${repo}`);
		console.log(`Security gate output: ${outputPath}`);
		console.log(`Unique open alerts: ${result.total_unique_alerts}`);
		console.log(
			`Severity: critical=${severity.critical}, high=${severity.high}, medium=${severity.medium}, low=${severity.low}, unknown=${severity.unknown}`
		);

		for (const [source, status] of Object.entries(snapshot.sources)) {
			const reasonSuffix = status.reason ? ` (${status.reason})` : "";
			console.log(
				`Source ${source}: status=${status.status}, total=${status.total_alerts}${reasonSuffix}`
			);
		}

		if (severity.medium > 0) {
			console.log(
				`::warning::Security gate detected ${severity.medium} open medium severity alert(s).`
			);
		}

		await writeStepSummary(buildStepSummary(result));

		if (blockingHighCount > 0) {
			console.log(
				`::error::Security gate failed: ${blockingHighCount} open high/critical alert(s) found.`
			);
			process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failureResult = {
			repository: repo,
			generated_at: new Date().toISOString(),
			total_unique_alerts: 0,
			blocking_high_count: 1,
			medium_count: 0,
			severity: {
				critical: 0,
				high: 1,
				medium: 0,
				low: 0,
				unknown: 0,
			},
			sources: {
				dependabot: { status: "error", reason: message, total_alerts: 0 },
				code_scanning: { status: "error", reason: message, total_alerts: 0 },
				secret_scanning: { status: "error", reason: message, total_alerts: 0 },
			},
			disabled_sources: [],
			collection_error: message,
		};

		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, JSON.stringify(failureResult, null, 2), "utf8");
		await writeStepSummary(buildStepSummary(failureResult));

		console.error(message);
		console.log(`Repository: ${repo}`);
		console.log(`Security gate output: ${outputPath}`);
		console.log("::error::Security gate failed: unable to collect alert data.");
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
