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

type ImgurEmbedKind = "image" | "album" | "gallery";

export interface ImgurEmbedTarget {
	kind: ImgurEmbedKind;
	id: string;
	embedUrl: string;
}

function getImgurId(candidate: string | undefined) {
	if (!candidate) return null;
	if (IMGUR_ID_PATTERN.test(candidate)) return candidate;

	const slugId = candidate.split("-").at(-1);
	return slugId && IMGUR_ID_PATTERN.test(slugId) ? slugId : null;
}

function getDirectImageId(segment: string | undefined) {
	if (!segment) return null;
	const lastDot = segment.lastIndexOf(".");
	if (lastDot < 1 || lastDot === segment.length - 1) {
		return getImgurId(segment);
	}

	const extension = segment.slice(lastDot + 1).toLowerCase();
	if (!DIRECT_FILE_EXTENSIONS.has(extension)) return null;
	return getImgurId(segment.slice(0, lastDot));
}

function createTarget(kind: ImgurEmbedKind, id: string, isAlbum = false): ImgurEmbedTarget {
	const embedPath = isAlbum ? `a/${id}` : id;
	return {
		kind,
		id,
		embedUrl: `https://imgur.com/${embedPath}/embed?context=false`,
	};
}

function getPageTarget(segments: string[]) {
	if (segments.length === 1) {
		const id = getDirectImageId(segments[0]);
		return id ? createTarget("image", id) : null;
	}
	if (segments.length !== 2) return null;

	const [kind, candidate] = segments;
	const id = getImgurId(candidate);
	if (!id) return null;
	if (kind.toLowerCase() === "a") return createTarget("album", id, true);
	if (kind.toLowerCase() === "gallery") return createTarget("gallery", id);
	return null;
}

export function getImgurEmbedTarget(value: string): ImgurEmbedTarget | null {
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
		!IMGUR_HOSTNAMES.has(url.hostname.toLowerCase())
	) {
		return null;
	}

	const hostname = url.hostname.toLowerCase();
	const segments = url.pathname.split("/").filter(Boolean);
	if (hostname === "i.imgur.com") {
		if (segments.length !== 1) return null;
		const id = getDirectImageId(segments[0]);
		return id ? createTarget("image", id) : null;
	}
	return getPageTarget(segments);
}

export function getImgurEmbedResizeHeight(
	event: { origin: string; data: unknown },
	target: ImgurEmbedTarget
) {
	if (event.origin !== "https://imgur.com") return null;

	let payload: unknown = event.data;
	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch {
			return null;
		}
	}
	if (!payload || typeof payload !== "object") return null;

	const message = payload as { message?: unknown; height?: unknown; href?: unknown };
	if (
		message.message !== "resize_imgur" ||
		typeof message.href !== "string" ||
		(typeof message.height !== "string" && typeof message.height !== "number")
	) {
		return null;
	}

	let messageUrl: URL;
	try {
		messageUrl = new URL(message.href);
	} catch {
		return null;
	}
	const expectedUrl = new URL(target.embedUrl);
	if (messageUrl.origin !== expectedUrl.origin || messageUrl.pathname !== expectedUrl.pathname) {
		return null;
	}

	const height = Number(message.height);
	if (!Number.isFinite(height) || height <= 0) return null;
	return Math.min(Math.max(Math.round(height), 200), 4_000);
}
