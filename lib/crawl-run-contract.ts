const CRAWL_SOURCES = ["arcalive", "battlepage", "insagirl"] as const;

export type CrawlSource = (typeof CRAWL_SOURCES)[number];
export type CrawlRunStatus = "running" | "succeeded" | "partial" | "failed" | "interrupted";
type CrawlRunTrigger = "manual" | "scheduled";
export type CrawlAlertSignal =
	| "parser-failure"
	| "parser-volume-drop"
	| "no-recent-success"
	| "transport-error-rate";

interface CrawlRunDetailItem {
	url?: string;
	message?: string;
	kind?: "network" | "parser";
	timeout?: boolean;
	code?: string;
	severity?: "info" | "warning";
	count?: number;
	attempt?: number;
}

interface CrawlParserObservation {
	url: string;
	status: "ok" | "empty" | "failure";
	candidateCount: number;
	validCount: number;
	discardedCount: number;
	ignoredCount?: number;
	duplicateCount?: number;
	minimumItems: number;
	attempt?: number;
}

export interface CrawlRun {
	id: string;
	source: CrawlSource;
	status: CrawlRunStatus;
	trigger: CrawlRunTrigger;
	startedAt: string;
	finishedAt: string | null;
	lastHeartbeatAt: string | null;
	durationMs: number | null;
	retryCount: number;
	recoveredCount: number;
	attemptedCount: number;
	succeededCount: number;
	extractedCount: number;
	insertedCount: number;
	skippedCount: number;
	warningCount: number;
	failureCount: number;
	networkFailureCount: number;
	parserFailureCount: number;
	timeoutFailureCount: number;
	parserValidCount: number;
	parserMinimumCount: number;
	warnings: CrawlRunDetailItem[];
	failures: CrawlRunDetailItem[];
	parserObservations: CrawlParserObservation[];
	errorStage: string | null;
	errorMessage: string | null;
}

interface ActiveCrawlRun {
	id: string;
	source: CrawlSource;
	status: "running";
	startedAt: string;
	staleAfter: string;
	lastHeartbeatAt: string | null;
}

interface CrawlRunTrendPoint {
	id: string;
	status: Exclude<CrawlRunStatus, "running">;
	startedAt: string;
	extractedCount: number;
	parserValidCount: number;
	parserMinimumCount: number;
	failureCount: number;
}

export interface CrawlSourceSummary {
	source: CrawlSource;
	scheduleEnabled: boolean;
	cooldownSeconds: number;
	runBudgetSeconds: number;
	lastFinishedAt: string | null;
	nextEligibleAt: string | null;
	activeAlertCount: number;
	lastSuccessAt: string | null;
	lastFailureAt: string | null;
	latest: {
		id: string;
		status: CrawlRunStatus;
		trigger: CrawlRunTrigger;
		startedAt: string;
		durationMs: number | null;
		extractedCount: number;
		insertedCount: number;
		retryCount: number;
		recoveredCount: number;
	} | null;
	trend: CrawlRunTrendPoint[];
}

interface CrawlAlertSnapshot {
	latestRunId: string | null;
	parserFailureTriggered: boolean;
	parserValidRatio: number | null;
	lastSuccessAt: string | null;
	hoursSinceSuccess: number | null;
	transportWindow: number;
	transportAttemptedCount: number;
	transportFailureCount: number;
	transportFailureRatio: number;
}

export interface CrawlAlertIncident {
	id: string;
	source: CrawlSource;
	activeSignals: CrawlAlertSignal[];
	openedAt: string;
	lastObservedAt: string;
	snapshot: CrawlAlertSnapshot;
}

export interface CrawlAlertSettings {
	parserFailureStreak: number;
	parserDropRatio: number;
	parserDropStreak: number;
	noSuccessSeconds: number;
	transportWindow: number;
	transportErrorRatio: number;
	transportMinFailures: number;
	lastEvaluatedAt: string | null;
}

export interface CrawlRunsDashboard {
	activeRun: ActiveCrawlRun | null;
	activeRuns: ActiveCrawlRun[];
	runtimeSettings: {
		maxConcurrency: number;
		lockTtlSeconds: number;
		heartbeatIntervalSeconds: number;
	};
	sources: CrawlSourceSummary[];
	runs: CrawlRun[];
	alerts: CrawlAlertIncident[];
	alertSettings: CrawlAlertSettings;
}

export function parseDashboardLimit(value: string | null, fallback = 20) {
	if (value === null) {
		return fallback;
	}
	if (!/^\d+$/u.test(value)) {
		return null;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : null;
}

export function isCrawlRunsDashboard(value: unknown): value is CrawlRunsDashboard {
	if (!value || typeof value !== "object") {
		return false;
	}
	const dashboard = value as Record<string, unknown>;
	const settings = dashboard.alertSettings as Record<string, unknown> | null;
	const runtimeSettings = dashboard.runtimeSettings as Record<string, unknown> | null;
	const validSettings =
		settings !== null &&
		typeof settings === "object" &&
		[
			"parserFailureStreak",
			"parserDropRatio",
			"parserDropStreak",
			"noSuccessSeconds",
			"transportWindow",
			"transportErrorRatio",
			"transportMinFailures",
		].every((key) => typeof settings[key] === "number" && Number.isFinite(settings[key]));
	return (
		Array.isArray(dashboard.activeRuns) &&
		Array.isArray(dashboard.sources) &&
		Array.isArray(dashboard.runs) &&
		Array.isArray(dashboard.alerts) &&
		runtimeSettings !== null &&
		typeof runtimeSettings === "object" &&
		["maxConcurrency", "lockTtlSeconds", "heartbeatIntervalSeconds"].every(
			(key) => typeof runtimeSettings[key] === "number" && Number.isFinite(runtimeSettings[key])
		) &&
		validSettings
	);
}
