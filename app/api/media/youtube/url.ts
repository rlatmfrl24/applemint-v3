const YOUTUBE_HOSTNAMES = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtu.be",
]);

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

type YouTubeUrlKind = "watch" | "short" | "live" | "embed" | "short-link" | "unsupported";

type YouTubeUrlFailureReason =
	| "not-youtube"
	| "unsupported-url"
	| "missing-video-id"
	| "invalid-video-id";

export interface NormalizedYouTubeUrl {
	kind: YouTubeUrlKind;
	mediaKind: "video" | "short" | "live" | "unsupported";
	videoId: string | null;
	failureReason: YouTubeUrlFailureReason | null;
}

function unsupported(failureReason: YouTubeUrlFailureReason): NormalizedYouTubeUrl {
	return {
		kind: "unsupported",
		mediaKind: "unsupported",
		videoId: null,
		failureReason,
	};
}

function normalizeCandidate(
	kind: Exclude<YouTubeUrlKind, "unsupported">,
	mediaKind: Exclude<NormalizedYouTubeUrl["mediaKind"], "unsupported">,
	candidate: string | null | undefined
): NormalizedYouTubeUrl {
	if (!candidate) {
		return { kind, mediaKind, videoId: null, failureReason: "missing-video-id" };
	}
	if (!VIDEO_ID_PATTERN.test(candidate)) {
		return { kind, mediaKind, videoId: null, failureReason: "invalid-video-id" };
	}
	return { kind, mediaKind, videoId: candidate, failureReason: null };
}

export function normalizeYouTubeUrl(value: string): NormalizedYouTubeUrl {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return unsupported("not-youtube");
	}

	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		!YOUTUBE_HOSTNAMES.has(url.hostname.toLowerCase())
	) {
		return unsupported("not-youtube");
	}

	const hostname = url.hostname.toLowerCase();
	const segments = url.pathname.split("/").filter(Boolean);
	if (hostname === "youtu.be") {
		return normalizeCandidate("short-link", "video", segments[0]);
	}

	const firstSegment = segments[0]?.toLowerCase();
	if (firstSegment === "watch") {
		return normalizeCandidate("watch", "video", url.searchParams.get("v"));
	}
	if (firstSegment === "shorts") {
		return normalizeCandidate("short", "short", segments[1]);
	}
	if (firstSegment === "live") {
		return normalizeCandidate("live", "live", segments[1]);
	}
	if (firstSegment === "embed") {
		return normalizeCandidate("embed", "video", segments[1]);
	}

	return unsupported("unsupported-url");
}
