import "server-only";
import { normalizeYouTubeUrl } from "@/app/api/media/youtube/url";
import { listYouTubeVideos } from "@/app/api/media/youtube/videos-list";
import type { BookmarkHealthEvidence } from "@/contracts/bookmark-health.schema";
import { getYouTubeApiKey } from "@/server/env/features";
import type { HealthMediaReference } from "./health-content";
import { type HealthFetchOptions, HealthRequestDeferred, safeFetch } from "./safe-fetch";

export type HealthIO = {
	continuation?: HealthFetchOptions["continuation"];
	signal: AbortSignal;
	beforeRequest: NonNullable<HealthFetchOptions["beforeRequest"]>;
};
type MediaResult = BookmarkHealthEvidence["media"]["items"][number];
export function classifyHealthMedia(
	ref: HealthMediaReference,
	response: Awaited<ReturnType<typeof safeFetch>>
): MediaResult {
	const base = {
		kind: ref.kind,
		label: ref.label,
		urlHash: ref.urlHash,
		httpStatus: response.status,
	};
	if ([404, 410].includes(response.status))
		return { ...base, state: "missing", reasonCode: "MEDIA_HTTP_MISSING" };
	if ([401, 403, 407, 429].includes(response.status))
		return { ...base, state: "restricted", reasonCode: "MEDIA_ACCESS_RESTRICTED" };
	if (response.status < 200 || response.status >= 300)
		return { ...base, state: "unknown", reasonCode: "MEDIA_RESPONSE_UNCERTAIN" };
	if (ref.kind === "embed")
		return { ...base, state: "unknown", reasonCode: "EMBED_PLAYBACK_UNVERIFIED" };
	const bytes = Buffer.from(response.bodyBytes);
	const image =
		(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
		/^GIF8[79]a/u.test(bytes.subarray(0, 6).toString("ascii")) ||
		(bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP");
	const video =
		bytes.subarray(4, 8).toString() === "ftyp" ||
		bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
	if (
		(ref.kind === "image" && /^image\//iu.test(response.contentType) && image) ||
		(ref.kind === "video" && /^video\//iu.test(response.contentType) && video)
	)
		return {
			...base,
			state: "reachable",
			reasonCode: ref.kind === "video" ? "PLAYBACK_UNVERIFIED" : "MEDIA_SEMANTICS_UNVERIFIED",
		};
	return { ...base, state: "unknown", reasonCode: "MEDIA_FORMAT_UNVERIFIED" };
}
export async function probeHealthMedia(
	ref: HealthMediaReference,
	io: HealthIO
): Promise<MediaResult> {
	const target = normalizeYouTubeUrl(ref.url);
	const key = getYouTubeApiKey();
	if (target.videoId && key) {
		return probeYouTube(ref, io, target.videoId, key);
	}
	try {
		return classifyHealthMedia(
			ref,
			await safeFetch(ref.url, {
				maxBytes: 65536,
				continuation: io.continuation,
				signal: io.signal,
				beforeRequest: io.beforeRequest,
				referrer: ref.sourceUrl,
			})
		);
	} catch (error) {
		if (error instanceof HealthRequestDeferred) throw error;
		return {
			kind: ref.kind,
			label: ref.label,
			urlHash: ref.urlHash,
			httpStatus: null,
			state: "unknown",
			reasonCode: "MEDIA_NETWORK_UNCERTAIN",
		};
	}
}

async function probeYouTube(
	ref: HealthMediaReference,
	io: HealthIO,
	videoId: string,
	key: string
): Promise<MediaResult> {
	const base = { kind: ref.kind, label: ref.label, urlHash: ref.urlHash, httpStatus: null };
	try {
		const release = await io.beforeRequest(new URL("https://www.googleapis.com/youtube/v3/videos"));
		try {
			const videos = await listYouTubeVideos([videoId], {
				apiKey: key,
				timeoutMs: Math.min(10000, io.signal.aborted ? 1 : 10000),
			});
			const video = videos.get(videoId);
			return {
				...base,
				state: video && "liveStatus" in video ? "reachable" : "unknown",
				reasonCode: video && "liveStatus" in video ? "PLAYBACK_UNVERIFIED" : "PROVIDER_UNAVAILABLE",
			};
		} finally {
			await release();
		}
	} catch (error) {
		if (error instanceof HealthRequestDeferred) throw error;
		return { ...base, state: "unknown", reasonCode: "PROVIDER_UNAVAILABLE" };
	}
}
