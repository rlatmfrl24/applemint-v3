export type MediaPreviewProvider = "youtube" | "imgur";

const ALLOWED_MEDIA_HOSTS: Record<MediaPreviewProvider, ReadonlySet<string>> = {
	youtube: new Set(["i.ytimg.com"]),
	imgur: new Set(["i.imgur.com"]),
};

export function getAllowedMediaUrl(
	value: string | null | undefined,
	provider: MediaPreviewProvider
) {
	if (!value) return null;

	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || !ALLOWED_MEDIA_HOSTS[provider].has(url.hostname)) {
			return null;
		}
		return url.href;
	} catch {
		return null;
	}
}

export function isVideoMediaUrl(value: string) {
	try {
		return /\.(?:mp4|webm)$/i.test(new URL(value).pathname);
	} catch {
		return false;
	}
}

export function isGifMediaUrl(value: string) {
	try {
		return /\.gif$/i.test(new URL(value).pathname);
	} catch {
		return false;
	}
}
