export const CRAWL_TARGETS = ["arcalive", "battlepage", "insagirl", "issuelink"] as const;

export type CrawlTarget = (typeof CRAWL_TARGETS)[number];

export interface FilterKeyword {
	value: string;
	method: string;
}

export async function constantTimeEquals(provided: string | null, expected: string | undefined) {
	if (!provided || !expected) {
		return false;
	}

	const encoder = new TextEncoder();
	const [providedDigest, expectedDigest] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(provided)),
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
	]);
	const providedBytes = new Uint8Array(providedDigest);
	const expectedBytes = new Uint8Array(expectedDigest);
	let difference = 0;

	for (let index = 0; index < providedBytes.length; index += 1) {
		difference |= providedBytes[index] ^ expectedBytes[index];
	}

	return difference === 0;
}

export function hasMinimumInternalSecretLength(secret: string | undefined): secret is string {
	return typeof secret === "string" && new TextEncoder().encode(secret).byteLength >= 32;
}

export function isCrawlTarget(value: unknown): value is CrawlTarget {
	return typeof value === "string" && CRAWL_TARGETS.some((target) => target === value);
}

export function defineType(value: string, filterList: FilterKeyword[]) {
	const targetMethod = filterList.find((filter) => value.includes(filter.value))?.method;
	return targetMethod || "normal";
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

export function countCrawlWarnings(failures: unknown[], warnings: unknown[]) {
	return failures.length + warnings.length;
}

export interface CrawlFailureLike {
	kind?: unknown;
	timeout?: unknown;
}

export interface ParserObservationLike {
	attempt?: unknown;
	status?: unknown;
	validCount?: unknown;
	minimumItems?: unknown;
}

export function countCrawlFailureKinds(failures: CrawlFailureLike[]) {
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

export function calculateParserTrend(observations: ParserObservationLike[], retryCount: number) {
	const finalAttempt = retryCount + 1;
	const finalObservations = observations.filter(
		(observation) => Number(observation.attempt ?? 1) === finalAttempt
	);

	return {
		parserValidCount: finalObservations.reduce(
			(total, observation) => total + Math.max(0, Number(observation.validCount) || 0),
			0
		),
		parserMinimumCount: finalObservations.reduce(
			(total, observation) =>
				observation.status === "empty"
					? total
					: total + Math.max(0, Number(observation.minimumItems) || 0),
			0
		),
	};
}

export function getCompletedRunStatus(failures: unknown[], warnings: unknown[]) {
	return failures.length > 0 || warnings.length > 0 ? "partial" : "succeeded";
}

export function normalizeCrawlApiBaseUrl(value: string | undefined) {
	if (!value) {
		return null;
	}

	try {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
			return null;
		}
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/$/, "");
	} catch {
		return null;
	}
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
