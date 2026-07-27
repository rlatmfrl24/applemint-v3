const IMGUR_HOSTNAMES = new Set(["imgur.com", "www.imgur.com", "i.imgur.com"]);
const IMGUR_ID_PATTERN = /^[A-Za-z0-9]{5,20}$/;
const DIRECT_FILE_EXTENSIONS = new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"gifv",
	"webp",
	"mp4",
	"webm",
]);

type ImgurUrlKind = "image" | "album" | "gallery" | "direct-file" | "unsupported";
type ImgurUrlFailureReason = "not-imgur" | "unsupported-url" | "missing-id" | "invalid-id";

export interface NormalizedImgurUrl {
	kind: ImgurUrlKind;
	mediaKind: "image" | "album" | "gallery" | "unsupported";
	externalId: string | null;
	fileExtension: string | null;
	failureReason: ImgurUrlFailureReason | null;
}

function unsupported(failureReason: ImgurUrlFailureReason): NormalizedImgurUrl {
	return {
		kind: "unsupported",
		mediaKind: "unsupported",
		externalId: null,
		fileExtension: null,
		failureReason,
	};
}

function normalizeId(
	kind: Exclude<ImgurUrlKind, "unsupported">,
	mediaKind: Exclude<NormalizedImgurUrl["mediaKind"], "unsupported">,
	candidate: string | undefined,
	fileExtension: string | null = null
): NormalizedImgurUrl {
	if (!candidate) {
		return { kind, mediaKind, externalId: null, fileExtension, failureReason: "missing-id" };
	}
	if (!IMGUR_ID_PATTERN.test(candidate)) {
		return { kind, mediaKind, externalId: null, fileExtension, failureReason: "invalid-id" };
	}
	return { kind, mediaKind, externalId: candidate, fileExtension, failureReason: null };
}

function splitDirectFile(segment: string) {
	const lastDot = segment.lastIndexOf(".");
	if (lastDot < 1 || lastDot === segment.length - 1) return null;
	const extension = segment.slice(lastDot + 1).toLowerCase();
	if (!DIRECT_FILE_EXTENSIONS.has(extension)) return null;
	return { id: segment.slice(0, lastDot), extension };
}

function normalizeDirectPath(segments: string[]) {
	if (segments.length !== 1) return unsupported("unsupported-url");
	const directFile = splitDirectFile(segments[0]);
	return directFile
		? normalizeId("direct-file", "image", directFile.id, directFile.extension)
		: normalizeId("direct-file", "image", segments[0]);
}

function normalizePagePath(segments: string[]) {
	const firstSegment = segments[0].toLowerCase();
	if (firstSegment === "a") {
		if (segments.length !== 2) return unsupported("unsupported-url");
		return normalizeId("album", "album", segments[1]);
	}
	if (firstSegment === "gallery") {
		if (segments.length !== 2) return unsupported("unsupported-url");
		return normalizeId("gallery", "gallery", segments[1]);
	}
	if (segments.length !== 1) return unsupported("unsupported-url");

	const directFile = splitDirectFile(segments[0]);
	return directFile
		? normalizeId("direct-file", "image", directFile.id, directFile.extension)
		: normalizeId("image", "image", segments[0]);
}

export function normalizeImgurUrl(value: string): NormalizedImgurUrl {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return unsupported("not-imgur");
	}

	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		!IMGUR_HOSTNAMES.has(url.hostname.toLowerCase())
	) {
		return unsupported("not-imgur");
	}

	const hostname = url.hostname.toLowerCase();
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length === 0) return unsupported("missing-id");

	return hostname === "i.imgur.com" ? normalizeDirectPath(segments) : normalizePagePath(segments);
}
