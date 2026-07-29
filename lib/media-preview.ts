const ALLOWED_YOUTUBE_THUMBNAIL_HOSTS = new Set(["i.ytimg.com"]);

export function getAllowedYouTubeThumbnailUrl(value: string | null | undefined) {
	if (!value) return null;

	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || !ALLOWED_YOUTUBE_THUMBNAIL_HOSTS.has(url.hostname)) {
			return null;
		}
		return url.href;
	} catch {
		return null;
	}
}
