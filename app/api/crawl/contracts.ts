import type { CrawlTarget } from "@/contracts/crawl-command.schema";
import type { CrawlItemType } from "@/lib/type-defs";

export type { CrawlTarget };

export interface CrawlFailure {
	url: string;
	message: string;
	kind: "network" | "parser";
	timeout?: boolean;
}

export interface CrawlWarning {
	url: string;
	code: "empty-list" | "below-minimum-items" | "discarded-items" | "high-discard-rate";
	severity: "info" | "warning";
	message: string;
	count: number;
}

interface ParserObservation {
	url: string;
	status: "ok" | "empty" | "failure";
	candidateCount: number;
	validCount: number;
	discardedCount: number;
	ignoredCount: number;
	duplicateCount: number;
	minimumItems: number;
}

export interface CrawlSourceResult {
	items: CrawlItemType[];
	attemptedUrls?: string[];
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
	recoveredCount: number;
	parserValidCount: number;
	parserMinimumCount: number;
}

export interface CrawlAdapterOptions {
	urls?: readonly string[];
	signal?: AbortSignal;
}

function withAttempt<T extends { url: string }>(value: T, attempt: number) {
	return { ...value, attempt };
}

function getAttemptedUrls(result: CrawlSourceResult) {
	return (
		result.attemptedUrls ??
		Array.from(
			new Set([
				...result.failures.map((failure) => failure.url),
				...result.parserObservations.map((observation) => observation.url),
			])
		)
	);
}

function applyAttemptResult(
	result: CrawlSourceResult,
	attempt: number,
	failures: Map<string, CrawlAttemptFailure>,
	warnings: Map<string, CrawlAttemptWarning[]>,
	observations: Map<string, CrawlAttemptParserObservation>
) {
	for (const url of getAttemptedUrls(result)) {
		failures.delete(url);
		warnings.delete(url);
		observations.delete(url);
	}
	for (const failure of result.failures) {
		failures.set(failure.url, withAttempt(failure, attempt));
	}
	for (const warning of result.warnings) {
		const current = warnings.get(warning.url) ?? [];
		current.push(withAttempt(warning, attempt));
		warnings.set(warning.url, current);
	}
	for (const observation of result.parserObservations) {
		observations.set(observation.url, withAttempt(observation, attempt));
	}
}

export function aggregateCrawlAttempts(attempts: CrawlSourceResult[]): CrawlExecutionResult {
	const failures = new Map<string, CrawlAttemptFailure>();
	const warnings = new Map<string, CrawlAttemptWarning[]>();
	const observations = new Map<string, CrawlAttemptParserObservation>();
	const initialFailedUrls = new Set(attempts[0]?.failures.map((failure) => failure.url) ?? []);
	const retriedUrls = new Set(attempts.slice(1).flatMap(getAttemptedUrls));

	for (let index = 0; index < attempts.length; index += 1) {
		applyAttemptResult(attempts[index], index + 1, failures, warnings, observations);
	}

	const terminalFailures = Array.from(failures.values());
	const terminalObservations = Array.from(observations.values());
	const terminalFailureUrls = new Set(terminalFailures.map((failure) => failure.url));
	const recoveredCount = Array.from(initialFailedUrls).filter(
		(url) => !terminalFailureUrls.has(url) && retriedUrls.has(url)
	).length;
	const dedupedItems = new Map<string, CrawlItemType>();
	for (const item of attempts.flatMap((attempt) => attempt.items)) {
		if (item.url && !dedupedItems.has(item.url)) {
			dedupedItems.set(item.url, item);
		}
	}

	return {
		items: Array.from(dedupedItems.values()),
		attempted: attempts.reduce((total, attempt) => total + attempt.attempted, 0),
		succeeded: attempts.reduce((total, attempt) => total + attempt.succeeded, 0),
		failures: terminalFailures,
		warnings: Array.from(warnings.values()).flat(),
		parserObservations: terminalObservations,
		retryCount: attempts.slice(1).reduce((total, attempt) => total + attempt.attempted, 0),
		recoveredCount,
		parserValidCount: terminalObservations.reduce(
			(total, observation) => total + observation.validCount,
			0
		),
		parserMinimumCount: terminalObservations.reduce(
			(total, observation) =>
				observation.status === "empty" ? total : total + observation.minimumItems,
			0
		),
	};
}

export function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Unknown error";
}

export function isTimeoutError(error: unknown) {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
