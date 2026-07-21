import { countBySeverity, dedupeAlertsByKey } from "./github-alerts.mjs";

const ALERT_BASELINE_SCHEMA_VERSION = 1;
const ALERT_BASELINE_POLICY = "zero-high-critical";

const BLOCKING_SEVERITIES = new Set(["critical", "high"]);

function isBlockingSeverity(severity) {
	return BLOCKING_SEVERITIES.has(String(severity ?? "unknown").toLowerCase());
}

function toBaselineEntry(alert) {
	return {
		key: alert.key,
		source: alert.source,
		severity: String(alert.severity ?? "unknown").toLowerCase(),
		package: alert.package ?? null,
		ghsa: alert.ghsa ?? null,
	};
}

function sortByKey(entries) {
	return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

function validateAlertBaseline(baseline) {
	if (!baseline || typeof baseline !== "object") {
		throw new Error("Security alert baseline must be an object.");
	}
	if (baseline.schemaVersion !== ALERT_BASELINE_SCHEMA_VERSION) {
		throw new Error(`Unsupported security alert baseline schema: ${baseline.schemaVersion}`);
	}
	if (baseline.policy !== ALERT_BASELINE_POLICY) {
		throw new Error(`Unsupported security alert baseline policy: ${baseline.policy}`);
	}
	if (!Array.isArray(baseline.alerts)) {
		throw new Error("Security alert baseline alerts must be an array.");
	}

	const keys = new Set();
	for (const alert of baseline.alerts) {
		if (!alert || typeof alert !== "object" || typeof alert.key !== "string" || !alert.key) {
			throw new Error("Every baseline alert must have a non-empty key.");
		}
		if (keys.has(alert.key)) {
			throw new Error(`Duplicate baseline alert key: ${alert.key}`);
		}
		keys.add(alert.key);
	}

	return baseline;
}

export function createAlertBaseline(alerts) {
	const uniqueAlerts = dedupeAlertsByKey(alerts).alerts;
	const blockingAlerts = uniqueAlerts.filter((alert) => isBlockingSeverity(alert.severity));
	if (blockingAlerts.length > 0) {
		throw new Error(
			`Cannot create a zero-high baseline while ${blockingAlerts.length} high/critical alert(s) are open.`
		);
	}

	return {
		schemaVersion: ALERT_BASELINE_SCHEMA_VERSION,
		policy: ALERT_BASELINE_POLICY,
		alerts: sortByKey(uniqueAlerts.map(toBaselineEntry)),
	};
}

export function compareAlertsWithBaseline(alerts, baseline) {
	validateAlertBaseline(baseline);
	const currentAlerts = sortByKey(dedupeAlertsByKey(alerts).alerts);
	const currentByKey = new Map(currentAlerts.map((alert) => [alert.key, alert]));
	const baselineByKey = new Map(baseline.alerts.map((alert) => [alert.key, alert]));

	return {
		currentAlerts,
		newAlerts: currentAlerts.filter((alert) => !baselineByKey.has(alert.key)),
		resolvedAlerts: baseline.alerts.filter((alert) => !currentByKey.has(alert.key)),
		blockingAlerts: currentAlerts.filter((alert) => isBlockingSeverity(alert.severity)),
	};
}

export function buildSecurityGateResult({ repository, snapshot, baseline }) {
	const compared = compareAlertsWithBaseline(snapshot.normalized_alerts, baseline);
	const severity = countBySeverity(compared.currentAlerts);
	const disabledSources = Object.entries(snapshot.sources)
		.filter(([, status]) => status.status === "disabled")
		.map(([name]) => name);

	return {
		repository,
		generated_at: snapshot.generated_at,
		policy: ALERT_BASELINE_POLICY,
		current_alert_count: compared.currentAlerts.length,
		baseline_alert_count: baseline.alerts.length,
		new_alerts: compared.newAlerts.map(toBaselineEntry),
		resolved_alerts: compared.resolvedAlerts,
		blocking_alerts: compared.blockingAlerts.map(toBaselineEntry),
		blocking_alert_count: compared.blockingAlerts.length,
		severity,
		sources: snapshot.sources,
		disabled_sources: disabledSources,
		collection_error: null,
	};
}

export function buildCollectionFailureResult(repository, message) {
	return {
		repository,
		generated_at: new Date().toISOString(),
		policy: ALERT_BASELINE_POLICY,
		current_alert_count: 0,
		baseline_alert_count: 0,
		new_alerts: [],
		resolved_alerts: [],
		blocking_alerts: [],
		blocking_alert_count: 1,
		severity: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
		sources: {},
		disabled_sources: [],
		collection_error: message,
	};
}
