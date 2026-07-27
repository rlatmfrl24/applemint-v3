import { parseYouTubeDuration } from "./duration";

export const YOUTUBE_VIDEOS_LIST_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
export const YOUTUBE_VIDEOS_LIST_PARTS = "snippet,contentDetails,status";
export const YOUTUBE_MAX_BATCH_SIZE = 50;

type FetchImplementation = typeof fetch;
type YouTubeLiveStatus = "none" | "live" | "upcoming";

interface YouTubeThumbnail {
	url?: unknown;
}

interface YouTubeVideoResource {
	id?: unknown;
	snippet?: {
		title?: unknown;
		channelTitle?: unknown;
		liveBroadcastContent?: unknown;
		thumbnails?: Record<string, YouTubeThumbnail> | null;
	};
	contentDetails?: {
		duration?: unknown;
	};
	status?: {
		privacyStatus?: unknown;
	};
}

interface YouTubeVideosListResponse {
	items?: unknown;
}

interface YouTubeVideoSummary {
	id: string;
	title: string | null;
	channelTitle: string | null;
	thumbnailUrl: string | null;
	durationSeconds: number;
	liveStatus: YouTubeLiveStatus;
}

interface InvalidYouTubeVideoSummary {
	id: string;
	errorCode: "YOUTUBE_INVALID_DURATION" | "YOUTUBE_INVALID_RESPONSE";
}

export type YouTubeVideoResult = YouTubeVideoSummary | InvalidYouTubeVideoSummary;

export type YouTubeApiErrorDisposition = "retryable" | "terminal";

export class YouTubeApiError extends Error {
	constructor(
		readonly code: string,
		readonly disposition: YouTubeApiErrorDisposition
	) {
		super(code);
		this.name = "YouTubeApiError";
	}
}

function chooseThumbnail(thumbnails: Record<string, YouTubeThumbnail> | null | undefined) {
	if (!thumbnails) return null;
	for (const key of ["maxres", "standard", "high", "medium", "default"]) {
		const value = thumbnails[key]?.url;
		if (typeof value === "string" && value.trim()) return value;
	}
	return null;
}

function getOptionalText(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}

function normalizeResource(
	resource: YouTubeVideoResource,
	requestedIds: ReadonlySet<string>
): YouTubeVideoResult | null {
	if (typeof resource.id !== "string" || !requestedIds.has(resource.id)) return null;

	const duration = resource.contentDetails?.duration;
	if (typeof duration !== "string") {
		return { id: resource.id, errorCode: "YOUTUBE_INVALID_RESPONSE" };
	}
	const durationSeconds = parseYouTubeDuration(duration);
	if (durationSeconds === null) {
		return { id: resource.id, errorCode: "YOUTUBE_INVALID_DURATION" };
	}

	const liveStatus = resource.snippet?.liveBroadcastContent;
	if (liveStatus !== "none" && liveStatus !== "live" && liveStatus !== "upcoming") {
		return { id: resource.id, errorCode: "YOUTUBE_INVALID_RESPONSE" };
	}

	return {
		id: resource.id,
		title: getOptionalText(resource.snippet?.title),
		channelTitle: getOptionalText(resource.snippet?.channelTitle),
		thumbnailUrl: chooseThumbnail(resource.snippet?.thumbnails),
		durationSeconds,
		liveStatus,
	};
}

function getHttpError(status: number) {
	if (status === 429) return new YouTubeApiError("YOUTUBE_HTTP_429", "retryable");
	if (status >= 500) return new YouTubeApiError("YOUTUBE_HTTP_5XX", "retryable");
	if (status >= 400 && status < 500) {
		return new YouTubeApiError("YOUTUBE_HTTP_4XX", "terminal");
	}
	return new YouTubeApiError("YOUTUBE_HTTP_ERROR", "terminal");
}

function getFetchError(error: unknown) {
	if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
		return new YouTubeApiError("YOUTUBE_TIMEOUT", "retryable");
	}
	return new YouTubeApiError("YOUTUBE_NETWORK", "retryable");
}

export async function listYouTubeVideos(
	videoIds: readonly string[],
	{
		apiKey,
		fetchImpl = fetch,
		timeoutMs = 10_000,
	}: {
		apiKey: string;
		fetchImpl?: FetchImplementation;
		timeoutMs?: number;
	}
): Promise<Map<string, YouTubeVideoResult>> {
	const uniqueIds = Array.from(new Set(videoIds));
	if (uniqueIds.length < 1 || uniqueIds.length > YOUTUBE_MAX_BATCH_SIZE) {
		throw new YouTubeApiError("YOUTUBE_INVALID_BATCH", "terminal");
	}
	if (uniqueIds.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))) {
		throw new YouTubeApiError("YOUTUBE_INVALID_VIDEO_ID", "terminal");
	}
	if (!apiKey.trim()) {
		throw new YouTubeApiError("YOUTUBE_API_KEY_MISSING", "terminal");
	}

	const requestUrl = new URL(YOUTUBE_VIDEOS_LIST_ENDPOINT);
	requestUrl.searchParams.set("part", YOUTUBE_VIDEOS_LIST_PARTS);
	requestUrl.searchParams.set("id", uniqueIds.join(","));
	requestUrl.searchParams.set("key", apiKey);

	let response: Response;
	try {
		response = await fetchImpl(requestUrl, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw getFetchError(error);
	}
	if (!response.ok) throw getHttpError(response.status);

	let payload: YouTubeVideosListResponse;
	try {
		payload = (await response.json()) as YouTubeVideosListResponse;
	} catch {
		throw new YouTubeApiError("YOUTUBE_INVALID_RESPONSE", "retryable");
	}
	if (!Array.isArray(payload.items)) {
		throw new YouTubeApiError("YOUTUBE_INVALID_RESPONSE", "retryable");
	}

	const requestedIds = new Set(uniqueIds);
	const summaries = new Map<string, YouTubeVideoResult>();
	for (const value of payload.items) {
		if (!value || typeof value !== "object") continue;
		const summary = normalizeResource(value as YouTubeVideoResource, requestedIds);
		if (summary && !summaries.has(summary.id)) summaries.set(summary.id, summary);
	}
	return summaries;
}
