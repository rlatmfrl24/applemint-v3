import { execSync } from "node:child_process";

const API_BASE_URL = "https://api.github.com";
const PAGE_SIZE = 100;

const SOURCE_CONFIG = {
	dependabot: {
		endpoint: "dependabot/alerts",
		normalize: normalizeDependabotAlert,
	},
	code_scanning: {
		endpoint: "code-scanning/alerts",
		normalize: normalizeCodeScanningAlert,
		disableOn404: true,
	},
	secret_scanning: {
		endpoint: "secret-scanning/alerts",
		normalize: normalizeSecretScanningAlert,
		disableOn404: true,
	},
};

function normalizeDependabotAlert(alert) {
	return {
		alert_number: alert.number ?? null,
		ghsa: alert.security_advisory?.ghsa_id ?? null,
		cve: alert.security_advisory?.cve_id ?? null,
		severity: alert.security_advisory?.severity ?? "unknown",
		package: alert.dependency?.package?.name ?? null,
		relationship: alert.dependency?.relationship ?? null,
		manifest_path: alert.dependency?.manifest_path ?? null,
		patched_version: alert.security_vulnerability?.first_patched_version?.identifier ?? null,
		state: alert.state ?? null,
		html_url: alert.html_url ?? null,
		created_at: alert.created_at ?? null,
		updated_at: alert.updated_at ?? null,
		source: "dependabot",
	};
}

function normalizeCodeScanningAlert(alert) {
	return {
		alert_number: alert.number ?? null,
		ghsa: null,
		cve: null,
		severity: mapCodeScanningSeverity(alert),
		package: alert.tool?.name ?? null,
		relationship: null,
		manifest_path: alert.most_recent_instance?.location?.path ?? null,
		patched_version: null,
		state: alert.state ?? null,
		html_url: alert.html_url ?? null,
		created_at: alert.created_at ?? null,
		updated_at: alert.updated_at ?? null,
		source: "code_scanning",
	};
}

function normalizeSecretScanningAlert(alert) {
	return {
		alert_number: alert.number ?? null,
		ghsa: null,
		cve: null,
		severity: "high",
		package: null,
		relationship: null,
		manifest_path: alert.locations_url ?? null,
		patched_version: null,
		state: alert.state ?? null,
		html_url: alert.html_url ?? null,
		created_at: alert.created_at ?? null,
		updated_at: alert.updated_at ?? null,
		source: "secret_scanning",
	};
}

function mapCodeScanningSeverity(alert) {
	const level = alert.rule?.security_severity_level ?? alert.rule?.severity ?? "unknown";
	const normalizedLevel = String(level).toLowerCase();

	if (["critical", "high", "error"].includes(normalizedLevel)) {
		return "high";
	}
	if (["medium", "warning"].includes(normalizedLevel)) {
		return "medium";
	}
	if (["low", "note"].includes(normalizedLevel)) {
		return "low";
	}
	return "unknown";
}

function parseRepoFromGitRemote(remoteUrl) {
	const trimmed = remoteUrl.trim();
	const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return `${sshMatch[1]}/${sshMatch[2]}`;
	}

	const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return `${httpsMatch[1]}/${httpsMatch[2]}`;
	}

	return null;
}

export function detectRepository(explicitRepo = null) {
	if (explicitRepo?.includes("/")) {
		return explicitRepo;
	}

	const fromEnv = process.env.GITHUB_REPOSITORY;
	if (fromEnv?.includes("/")) {
		return fromEnv;
	}

	try {
		const remoteUrl = execSync("git config --get remote.origin.url", {
			encoding: "utf8",
		});
		const parsed = parseRepoFromGitRemote(remoteUrl);
		if (parsed) {
			return parsed;
		}
	} catch (_error) {
		// Ignore and throw a clearer error below.
	}

	throw new Error("Cannot detect repository. Pass --repo owner/name or set GITHUB_REPOSITORY.");
}

export function detectToken() {
	if (process.env.GITHUB_TOKEN) {
		return process.env.GITHUB_TOKEN;
	}
	if (process.env.GH_TOKEN) {
		return process.env.GH_TOKEN;
	}

	try {
		const token = execSync("gh auth token", { encoding: "utf8" }).trim();
		if (token) {
			return token;
		}
	} catch (_error) {
		// Fall through to the explicit error.
	}

	throw new Error("Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN) or run `gh auth login`.");
}

function parseNextLink(linkHeader) {
	if (!linkHeader) {
		return null;
	}

	const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
	return nextMatch ? nextMatch[1] : null;
}

async function fetchAlertPage({ token, url }) {
	const response = await fetch(url, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});

	if (response.status === 404) {
		return { status: 404, alerts: [] };
	}

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`GitHub API request failed (${response.status}) for ${url}: ${body}`);
	}

	const alerts = await response.json();
	if (!Array.isArray(alerts)) {
		throw new Error(`Unexpected response for ${url}: expected array`);
	}

	return {
		status: response.status,
		alerts,
		nextUrl: parseNextLink(response.headers.get("link")),
	};
}

async function fetchOpenAlertsForSource({ repo, token, source }) {
	const sourceInfo = SOURCE_CONFIG[source];
	const collected = [];
	let nextUrl = new URL(`${API_BASE_URL}/repos/${repo}/${sourceInfo.endpoint}`);
	nextUrl.searchParams.set("state", "open");
	nextUrl.searchParams.set("per_page", String(PAGE_SIZE));

	while (nextUrl) {
		const {
			status,
			alerts,
			nextUrl: candidateNextUrl,
		} = await fetchAlertPage({
			token,
			url: nextUrl,
		});

		if (status === 404 && sourceInfo.disableOn404) {
			return {
				source,
				status: "disabled",
				reason: "404_not_enabled_or_not_accessible",
				alerts: [],
			};
		}

		collected.push(...alerts);
		nextUrl = candidateNextUrl ? new URL(candidateNextUrl) : null;
	}

	return {
		source,
		status: "ok",
		reason: null,
		alerts: collected,
	};
}

export async function fetchAndNormalizeAlerts({ repo, token }) {
	const perSource = {};
	const normalized = [];

	for (const source of Object.keys(SOURCE_CONFIG)) {
		const result = await fetchOpenAlertsForSource({ repo, token, source });
		perSource[source] = {
			status: result.status,
			reason: result.reason,
			total_alerts: result.alerts.length,
		};

		if (result.status === "ok") {
			normalized.push(...result.alerts.map((alert) => SOURCE_CONFIG[source].normalize(alert)));
		}
	}

	const dedupedByNumber = dedupeByAlertNumber(normalized);
	const dedupedAdvisories = dedupeByAdvisory(normalized);

	return {
		repository: repo,
		generated_at: new Date().toISOString(),
		sources: perSource,
		normalized_alerts: normalized,
		dedup: {
			alert_count_raw: normalized.length,
			alert_count_unique_by_number: dedupedByNumber.alerts.length,
			alert_duplicate_numbers: dedupedByNumber.duplicate_numbers,
			advisory_count_unique_ghsa_package: dedupedAdvisories.length,
			advisories_unique_ghsa_package: dedupedAdvisories,
		},
	};
}

export function dedupeByAlertNumber(alerts) {
	const seen = new Set();
	const duplicateNumbers = new Set();
	const uniqueAlerts = [];

	for (const alert of alerts) {
		const key = String(alert.alert_number);
		if (seen.has(key)) {
			duplicateNumbers.add(alert.alert_number);
			continue;
		}
		seen.add(key);
		uniqueAlerts.push(alert);
	}

	return {
		alerts: uniqueAlerts,
		duplicate_numbers: [...duplicateNumbers].sort((a, b) => Number(a) - Number(b)),
	};
}

function dedupeByAdvisory(alerts) {
	const seen = new Set();
	const advisories = [];

	for (const alert of alerts) {
		if (!alert.ghsa || !alert.package) {
			continue;
		}

		const key = `${alert.ghsa}::${alert.package}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		advisories.push({
			ghsa: alert.ghsa,
			package: alert.package,
			severity: alert.severity,
			patched_version: alert.patched_version,
		});
	}

	return advisories.sort((a, b) =>
		`${a.ghsa}::${a.package}`.localeCompare(`${b.ghsa}::${b.package}`)
	);
}

export function countBySeverity(alerts) {
	const counts = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		unknown: 0,
	};

	for (const alert of alerts) {
		const severity = String(alert.severity ?? "unknown").toLowerCase();
		if (Object.hasOwn(counts, severity)) {
			counts[severity] += 1;
		} else {
			counts.unknown += 1;
		}
	}

	return counts;
}
