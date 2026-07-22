import type { CrawlExecutionResult } from "./contracts";

export interface FilterKeyword {
	value: string;
	method: string;
}

export type CrawlErrorStage = "source" | "filter" | "history" | "ingest" | "unknown";

export function defineType(value: string, filterList: FilterKeyword[]) {
	return filterList.find((filter) => value.includes(filter.value))?.method || "normal";
}

export function dedupeByUrl<T extends { url: string }>(items: T[]) {
	const deduped = new Map<string, T>();
	for (const item of items) {
		if (item.url && !deduped.has(item.url)) {
			deduped.set(item.url, item);
		}
	}
	return Array.from(deduped.values());
}

export function chunkUrlsForHistoryQuery(
	urls: string[],
	maxItems = 200,
	maxEncodedCharacters = 6000
) {
	const chunks: string[][] = [];
	let currentChunk: string[] = [];
	let currentEncodedCharacters = 0;

	for (const url of urls) {
		const encodedCharacters = encodeURIComponent(url).length + 3;
		const exceedsLimit =
			currentChunk.length > 0 &&
			(currentChunk.length >= maxItems ||
				currentEncodedCharacters + encodedCharacters > maxEncodedCharacters);
		if (exceedsLimit) {
			chunks.push(currentChunk);
			currentChunk = [];
			currentEncodedCharacters = 0;
		}
		currentChunk.push(url);
		currentEncodedCharacters += encodedCharacters;
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}
	return chunks;
}

function countCrawlFailureKinds(failures: CrawlExecutionResult["failures"]) {
	let networkFailureCount = 0;
	let parserFailureCount = 0;
	let timeoutFailureCount = 0;

	for (const failure of failures) {
		if (failure.timeout === true) {
			timeoutFailureCount += 1;
		} else if (failure.kind === "parser") {
			parserFailureCount += 1;
		} else {
			networkFailureCount += 1;
		}
	}

	return { networkFailureCount, parserFailureCount, timeoutFailureCount };
}

interface CrawlWarningLike {
	code?: unknown;
	severity?: unknown;
}

function isActionableCrawlWarning(warning: CrawlWarningLike) {
	if (warning.severity === "warning") {
		return true;
	}
	if (warning.severity === "info") {
		return false;
	}

	return warning.code === "below-minimum-items" || warning.code === "high-discard-rate";
}

export function countActionableCrawlWarnings(warnings: CrawlWarningLike[]) {
	return warnings.filter(isActionableCrawlWarning).length;
}

export function countCrawlWarnings(failures: unknown[], warnings: CrawlWarningLike[]) {
	return failures.length + countActionableCrawlWarnings(warnings);
}

export function getCompletedRunStatus(crawlData: CrawlExecutionResult) {
	return crawlData.failures.length > 0 || countActionableCrawlWarnings(crawlData.warnings) > 0
		? ("partial" as const)
		: ("succeeded" as const);
}

export function createRunResult(
	status: "succeeded" | "partial" | "failed",
	crawlData: CrawlExecutionResult | null,
	insertedCount: number,
	skippedCount: number,
	errorStage: CrawlErrorStage | null = null,
	errorMessage: string | null = null
) {
	const failures = crawlData?.failures ?? [];
	const warnings = crawlData?.warnings ?? [];
	const parserObservations = crawlData?.parserObservations ?? [];

	return {
		status,
		retryCount: Math.max(0, Number(crawlData?.retryCount ?? 0)),
		recoveredCount: Math.max(0, Number(crawlData?.recoveredCount ?? 0)),
		attemptedCount: Math.max(0, Number(crawlData?.attempted ?? 0)),
		succeededCount: Math.max(0, Number(crawlData?.succeeded ?? 0)),
		extractedCount: crawlData?.items.length ?? 0,
		insertedCount: Math.max(0, insertedCount),
		skippedCount: Math.max(0, skippedCount),
		warningCount: countActionableCrawlWarnings(warnings),
		failureCount: failures.length,
		...countCrawlFailureKinds(failures),
		parserValidCount: Math.max(0, Number(crawlData?.parserValidCount ?? 0)),
		parserMinimumCount: Math.max(0, Number(crawlData?.parserMinimumCount ?? 0)),
		warnings,
		failures,
		parserObservations,
		errorStage,
		errorMessage,
	};
}
