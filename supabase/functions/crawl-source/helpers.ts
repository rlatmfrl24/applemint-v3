const CRAWL_TARGETS = ["arcalive", "battlepage", "insagirl"] as const;

export type CrawlTarget = (typeof CRAWL_TARGETS)[number];

export interface FilterKeyword {
	value: string;
	method: string;
}

interface CrawlFailureLike {
	kind?: unknown;
	timeout?: unknown;
}

interface CrawlWarningLike {
	code?: unknown;
	severity?: unknown;
}

interface ParserObservationLike {
	status?: unknown;
	validCount?: unknown;
	minimumItems?: unknown;
}

const YOUTUBE_HOSTNAMES = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtu.be",
]);
const IMGUR_HOSTNAMES = new Set(["imgur.com", "www.imgur.com", "i.imgur.com"]);

function detectMediaProvider(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}

	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		!url.pathname.split("/").some(Boolean)
	) {
		return null;
	}

	const hostname = url.hostname.toLowerCase();
	if (YOUTUBE_HOSTNAMES.has(hostname)) return "youtube";
	if (IMGUR_HOSTNAMES.has(hostname)) return "imgur";
	return null;
}

function isActionableCrawlWarning(warning: CrawlWarningLike) {
	if (warning.severity === "warning") return true;
	if (warning.severity === "info") return false;
	return warning.code === "below-minimum-items" || warning.code === "high-discard-rate";
}

export function defineType(value: string, filterList: FilterKeyword[]) {
	const provider = detectMediaProvider(value);
	if (provider) return provider;
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

	if (currentChunk.length > 0) chunks.push(currentChunk);
	return chunks;
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

export function countCrawlWarnings(failures: unknown[], warnings: CrawlWarningLike[]) {
	return failures.length + warnings.filter(isActionableCrawlWarning).length;
}

export function getCompletedRunStatus(failures: unknown[], warnings: CrawlWarningLike[]) {
	return failures.length > 0 || warnings.some(isActionableCrawlWarning)
		? ("partial" as const)
		: ("succeeded" as const);
}

export function calculateParserTrend(
	parserObservations: ParserObservationLike[],
	_retryCount: number
) {
	return {
		parserValidCount: parserObservations.reduce(
			(total, observation) => total + Math.max(0, Number(observation.validCount ?? 0)),
			0
		),
		parserMinimumCount: parserObservations.reduce(
			(total, observation) =>
				observation.status === "empty"
					? total
					: total + Math.max(0, Number(observation.minimumItems ?? 0)),
			0
		),
	};
}

export function isCrawlTarget(value: unknown): value is CrawlTarget {
	return typeof value === "string" && CRAWL_TARGETS.some((target) => target === value);
}

export function hasMinimumInternalSecretLength(secret: string | undefined): secret is string {
	return typeof secret === "string" && new TextEncoder().encode(secret).byteLength >= 32;
}

async function digest(value: string) {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function constantTimeEquals(provided: string | null, expected: string) {
	const [providedDigest, expectedDigest] = await Promise.all([
		digest(provided ?? ""),
		digest(expected),
	]);
	let difference = provided ? 0 : 1;
	for (let index = 0; index < expectedDigest.length; index += 1) {
		difference |= providedDigest[index] ^ expectedDigest[index];
	}
	return difference === 0;
}

export function normalizeCrawlApiBaseUrl(value: string | undefined) {
	const candidate = value?.trim();
	if (!candidate) return "";

	try {
		const url = new URL(candidate);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
			return "";
		}
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/+$/, "");
	} catch {
		return "";
	}
}
