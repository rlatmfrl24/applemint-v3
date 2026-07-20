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
