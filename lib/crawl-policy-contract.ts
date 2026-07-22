const CRAWL_SOURCES = ["arcalive", "battlepage", "insagirl"] as const;

export type CrawlPolicySource = (typeof CRAWL_SOURCES)[number];

interface CrawlPolicyLatestRun {
	id: string;
	status: "running" | "succeeded" | "partial" | "failed" | "interrupted";
	trigger: "manual" | "scheduled";
	startedAt: string;
	finishedAt: string | null;
	insertedCount: number;
	retryCount: number;
	recoveredCount: number;
}

export interface CrawlSourcePolicy {
	source: CrawlPolicySource;
	scheduleEnabled: boolean;
	cooldownSeconds: number;
	recommendedCooldownSeconds: number;
	runBudgetSeconds: number;
	updatedAt: string;
	lastFinishedAt: string | null;
	nextEligibleAt: string;
	nextScheduledAt: string | null;
	activeRunId: string | null;
	latest: CrawlPolicyLatestRun | null;
}

export interface CrawlPolicySettings {
	schedulerEnabled: boolean;
	serverNow: string;
	dispatcherIntervalSeconds: number;
	sources: CrawlSourcePolicy[];
}

export function isCrawlPolicySource(value: unknown): value is CrawlPolicySource {
	return CRAWL_SOURCES.includes(value as CrawlPolicySource);
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isLatestRun(value: unknown): value is CrawlPolicyLatestRun | null {
	if (value === null) return true;
	if (!value || typeof value !== "object") return false;
	const latest = value as Record<string, unknown>;
	return (
		typeof latest.id === "string" &&
		["running", "succeeded", "partial", "failed", "interrupted"].includes(String(latest.status)) &&
		["manual", "scheduled"].includes(String(latest.trigger)) &&
		typeof latest.startedAt === "string" &&
		isNullableString(latest.finishedAt) &&
		[latest.insertedCount, latest.retryCount, latest.recoveredCount].every(isFiniteNumber)
	);
}

function isSourcePolicy(value: unknown): value is CrawlSourcePolicy {
	if (!value || typeof value !== "object") return false;
	const policy = value as Record<string, unknown>;
	return (
		isCrawlPolicySource(policy.source) &&
		typeof policy.scheduleEnabled === "boolean" &&
		[policy.cooldownSeconds, policy.recommendedCooldownSeconds, policy.runBudgetSeconds].every(
			isFiniteNumber
		) &&
		typeof policy.updatedAt === "string" &&
		isNullableString(policy.lastFinishedAt) &&
		typeof policy.nextEligibleAt === "string" &&
		isNullableString(policy.nextScheduledAt) &&
		isNullableString(policy.activeRunId) &&
		isLatestRun(policy.latest)
	);
}

export function isCrawlPolicySettings(value: unknown): value is CrawlPolicySettings {
	if (!value || typeof value !== "object") return false;
	const settings = value as Record<string, unknown>;
	return (
		typeof settings.schedulerEnabled === "boolean" &&
		typeof settings.serverNow === "string" &&
		isFiniteNumber(settings.dispatcherIntervalSeconds) &&
		Array.isArray(settings.sources) &&
		settings.sources.length === CRAWL_SOURCES.length &&
		settings.sources.every(isSourcePolicy)
	);
}
