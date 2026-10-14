import { getNormalSiteKey } from "./community";

export function collectionForHost<T extends { id: string; name: string }>(
	url: string,
	collections: T[]
): T | null {
	let host: string;
	try {
		const parsed = new URL(url);
		if (!["http:", "https:"].includes(parsed.protocol)) return null;
		host = getNormalSiteKey(parsed.hostname);
	} catch {
		return null;
	}
	const names = new Set([host]);
	if (host === "arca.live") names.add("arcalive");
	else if (host.split(".").length === 2) names.add(host.split(".")[0]);
	else if (/^[^.]+\.co\.kr$/u.test(host)) names.add(host.split(".")[0]);
	const matches = collections.filter((collection) =>
		names.has(collection.name.trim().toLowerCase())
	);
	return matches.length === 1 ? matches[0] : null;
}
