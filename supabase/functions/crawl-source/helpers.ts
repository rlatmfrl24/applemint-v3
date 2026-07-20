export const CRAWL_TARGETS = ["arcalive", "battlepage", "insagirl", "issuelink"] as const;

export const MEDIA_EXTENSIONS = new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"bmp",
	"tiff",
	"svg",
	"ico",
	"mp4",
	"webm",
	"mov",
	"avi",
	"mkv",
	"flv",
	"vob",
	"ogv",
	"ogg",
	"drc",
	"mng",
]);

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

function getYoutubeId(url: string) {
	const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/);
	return match?.[2]?.length === 11 ? match[2] : null;
}

export function getUrlExtension(value: string) {
	try {
		const pathname = new URL(value).pathname.toLowerCase();
		const segment = pathname.split("/").at(-1) ?? "";
		return segment.includes(".") ? (segment.split(".").at(-1) ?? "") : "";
	} catch {
		return "";
	}
}

export function defineType(value: string, filterList: FilterKeyword[]) {
	const targetMethod = filterList.find((filter) => value.includes(filter.value))?.method;

	if (targetMethod === "youtube" && getYoutubeId(value) === null) {
		return "normal";
	}

	if (targetMethod === "media" && MEDIA_EXTENSIONS.has(getUrlExtension(value))) {
		return "media";
	}

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
