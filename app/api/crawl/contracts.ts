import type { CrawlItemType } from "@/lib/type-defs";

const CRAWL_TARGETS = ["arcalive", "battlepage", "insagirl", "issuelink"] as const;

export type CrawlTarget = (typeof CRAWL_TARGETS)[number];

export interface CrawlFailure {
	url: string;
	message: string;
	kind: "network" | "parser";
	timeout?: boolean;
}

export interface CrawlWarning {
	url: string;
	code: "empty-list" | "below-minimum-items" | "discarded-items";
	message: string;
	count: number;
}

interface ParserObservation {
	url: string;
	status: "ok" | "empty" | "failure";
	candidateCount: number;
	validCount: number;
	discardedCount: number;
	minimumItems: number;
}

export interface CrawlSourceResult {
	items: CrawlItemType[];
	attempted: number;
	succeeded: number;
	failures: CrawlFailure[];
	warnings: CrawlWarning[];
	parserObservations: ParserObservation[];
}

interface CrawlAttemptFailure extends CrawlFailure {
	attempt: number;
}

interface CrawlAttemptWarning extends CrawlWarning {
	attempt: number;
}

interface CrawlAttemptParserObservation extends ParserObservation {
	attempt: number;
}

export interface CrawlExecutionResult {
	items: CrawlItemType[];
	attempted: number;
	succeeded: number;
	failures: CrawlAttemptFailure[];
	warnings: CrawlAttemptWarning[];
	parserObservations: CrawlAttemptParserObservation[];
	retryCount: number;
	parserValidCount: number;
	parserMinimumCount: number;
}

export function aggregateCrawlAttempts(attempts: CrawlSourceResult[]): CrawlExecutionResult {
	const finalAttempt = attempts.at(-1);
	const finalObservations = finalAttempt?.parserObservations ?? [];

	return {
		items: finalAttempt?.items ?? [],
		attempted: attempts.reduce((total, attempt) => total + attempt.attempted, 0),
		succeeded: attempts.reduce((total, attempt) => total + attempt.succeeded, 0),
		failures: attempts.flatMap((attempt, index) =>
			attempt.failures.map((failure) => ({ ...failure, attempt: index + 1 }))
		),
		warnings: attempts.flatMap((attempt, index) =>
			attempt.warnings.map((warning) => ({ ...warning, attempt: index + 1 }))
		),
		parserObservations: attempts.flatMap((attempt, index) =>
			(attempt.parserObservations ?? []).map((observation) => ({
				...observation,
				attempt: index + 1,
			}))
		),
		retryCount: Math.max(0, attempts.length - 1),
		parserValidCount: finalObservations.reduce(
			(total, observation) => total + observation.validCount,
			0
		),
		parserMinimumCount: finalObservations.reduce(
			(total, observation) =>
				observation.status === "empty" ? total : total + observation.minimumItems,
			0
		),
	};
}

export function isCrawlTarget(value: unknown): value is CrawlTarget {
	return typeof value === "string" && CRAWL_TARGETS.some((target) => target === value);
}

export function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Unknown error";
}

export function isTimeoutError(error: unknown) {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
