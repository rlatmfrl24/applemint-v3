export type DetectedThreadType = "youtube" | "imgur";

const YOUTUBE_HOSTNAMES = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtu.be",
]);
const IMGUR_HOSTNAMES = new Set(["imgur.com", "www.imgur.com", "i.imgur.com"]);

const hasContentPath = (pathname: string) => pathname.split("/").some(Boolean);

export function detectKnownThreadType(value: string): DetectedThreadType | null {
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
		!hasContentPath(url.pathname)
	) {
		return null;
	}

	const hostname = url.hostname.toLowerCase();
	if (YOUTUBE_HOSTNAMES.has(hostname)) return "youtube";
	if (IMGUR_HOSTNAMES.has(hostname)) return "imgur";
	return null;
}
