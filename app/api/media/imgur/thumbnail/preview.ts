import { load } from "cheerio";

const IMGUR_MEDIA_HOSTNAME = "i.imgur.com";
const IMGUR_MEDIA_PATH_PATTERN = /^\/[A-Za-z0-9]{5,21}\.(?:gif|jpe?g|png|webp)$/i;
const IMGUR_VIDEO_PATH_PATTERN = /^\/([A-Za-z0-9]{5,20})\.(?:mp4|webm)$/i;

type PreviewCandidate = {
	value: string | undefined;
	isSmallThumbnail?: boolean;
};

function normalizePreviewCandidate(candidate: PreviewCandidate) {
	if (!candidate.value) return null;

	let url: URL;
	try {
		url = new URL(candidate.value, "https://imgur.com");
	} catch {
		return null;
	}

	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.hostname.toLowerCase() !== IMGUR_MEDIA_HOSTNAME ||
		!IMGUR_MEDIA_PATH_PATTERN.test(url.pathname)
	) {
		return null;
	}

	if (candidate.isSmallThumbnail) {
		url.pathname = url.pathname.replace(
			/^\/([A-Za-z0-9]{5,20})s(\.(?:gif|jpe?g|png|webp))$/i,
			"/$1l$2"
		);
	}
	url.search = "";
	url.hash = "";
	return url.toString();
}

function getVideoSourcePoster(value: string | undefined) {
	if (!value) return null;

	let url: URL;
	try {
		url = new URL(value, "https://imgur.com");
	} catch {
		return null;
	}

	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.hostname.toLowerCase() !== IMGUR_MEDIA_HOSTNAME
	) {
		return null;
	}

	const match = url.pathname.match(IMGUR_VIDEO_PATH_PATTERN);
	return match ? `https://i.imgur.com/${match[1]}l.jpg` : null;
}

function getAnimatedAlbumPoster(html: string) {
	const albumImagesStart = html.indexOf('"album_images"');
	if (albumImagesStart < 0) return null;

	const firstImageStart = html.indexOf('"images":[{', albumImagesStart);
	if (firstImageStart < 0) return null;

	const firstImageMetadata = html.slice(firstImageStart, firstImageStart + 2_000);
	if (!/"animated"\s*:\s*true/i.test(firstImageMetadata)) return null;

	const hash = firstImageMetadata.match(/"hash"\s*:\s*"([A-Za-z0-9]{5,20})"/i)?.[1];
	return hash ? `https://i.imgur.com/${hash}l.jpg` : null;
}

export function getImgurPreviewImageUrl(html: string) {
	const $ = load(html);
	const candidates: PreviewCandidate[] = [
		{ value: $("#image-element").attr("src") },
		{ value: $("#image-container-inner img").first().attr("src") },
		{ value: $("video[poster]").first().attr("poster") },
		{ value: getVideoSourcePoster($("source[src]").first().attr("src")) ?? undefined },
		{ value: getAnimatedAlbumPoster(html) ?? undefined },
		{
			value: $(".thumb-title-embed[data-src]").first().attr("data-src"),
			isSmallThumbnail: true,
		},
	];

	for (const candidate of candidates) {
		const previewUrl = normalizePreviewCandidate(candidate);
		if (previewUrl) return previewUrl;
	}
	return null;
}
