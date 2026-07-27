import { getAllowedMediaUrl, isVideoMediaUrl } from "@/lib/media-preview";
import type { NormalizedImgurUrl } from "./url";

const IMGUR_API_BASE_URL = "https://api.imgur.com/3";
const IMGUR_PREVIEW_LIMIT = 4;

type FetchImplementation = typeof fetch;
export type ImgurApiErrorDisposition = "retryable" | "unavailable" | "terminal";

interface ImgurApiEnvelope {
	data?: unknown;
}

interface ImgurResource {
	id?: unknown;
	title?: unknown;
	description?: unknown;
	type?: unknown;
	link?: unknown;
	cover?: unknown;
	images_count?: unknown;
}

export interface ImgurMetadataSummary {
	title: string | null;
	mediaKind: "image" | "video" | "album" | "gallery";
	thumbnailUrl: string | null;
	mediaCount: number;
	previewUrls: string[];
}

export class ImgurApiError extends Error {
	constructor(
		readonly code: string,
		readonly disposition: ImgurApiErrorDisposition
	) {
		super(code);
		this.name = "ImgurApiError";
	}
}

function getOptionalText(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNonNegativeInteger(value: unknown) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function getResourceTitle(resource: ImgurResource) {
	return getOptionalText(resource.title) ?? getOptionalText(resource.description);
}

function getResourceId(resource: ImgurResource) {
	return getOptionalText(resource.id);
}

function getResourceUrl(resource: ImgurResource) {
	return getAllowedMediaUrl(getOptionalText(resource.link), "imgur");
}

function normalizeImages(value: unknown) {
	if (!Array.isArray(value)) {
		throw new ImgurApiError("IMGUR_INVALID_RESPONSE", "retryable");
	}
	return value.filter((item): item is ImgurResource => Boolean(item) && typeof item === "object");
}

function getPreviewUrls(images: ImgurResource[]) {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const image of images) {
		const url = getResourceUrl(image);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
		if (urls.length === IMGUR_PREVIEW_LIMIT) break;
	}
	return urls;
}

function getImageMediaKind(resource: ImgurResource, url: string | null) {
	const mimeType = getOptionalText(resource.type)?.toLowerCase();
	return mimeType?.startsWith("video/") || (url ? isVideoMediaUrl(url) : false) ? "video" : "image";
}

function normalizeImage(
	resource: ImgurResource,
	mediaKind: "image" | "gallery" = "image"
): ImgurMetadataSummary {
	const url = getResourceUrl(resource);
	return {
		title: getResourceTitle(resource),
		mediaKind: mediaKind === "gallery" ? "gallery" : getImageMediaKind(resource, url),
		thumbnailUrl: url,
		mediaCount: 1,
		previewUrls: url ? [url] : [],
	};
}

function normalizeCollection(
	resource: ImgurResource,
	images: ImgurResource[],
	mediaKind: "album" | "gallery"
): ImgurMetadataSummary {
	const previewUrls = getPreviewUrls(images);
	const coverId = getOptionalText(resource.cover);
	const coverUrl = coverId
		? getResourceUrl(images.find((image) => getResourceId(image) === coverId) ?? {})
		: null;
	return {
		title: getResourceTitle(resource),
		mediaKind,
		thumbnailUrl: coverUrl ?? previewUrls[0] ?? null,
		mediaCount: getNonNegativeInteger(resource.images_count) ?? images.length,
		previewUrls,
	};
}

function getHttpError(status: number) {
	if (status === 404) return new ImgurApiError("IMGUR_HTTP_404", "unavailable");
	if (status === 429) return new ImgurApiError("IMGUR_HTTP_429", "retryable");
	if (status >= 500) return new ImgurApiError("IMGUR_HTTP_5XX", "retryable");
	if (status >= 400 && status < 500) {
		return new ImgurApiError("IMGUR_HTTP_4XX", "terminal");
	}
	return new ImgurApiError("IMGUR_HTTP_ERROR", "terminal");
}

function getFetchError(error: unknown) {
	if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
		return new ImgurApiError("IMGUR_TIMEOUT", "retryable");
	}
	return new ImgurApiError("IMGUR_NETWORK", "retryable");
}

async function requestImgur(
	pathname: string,
	{
		clientId,
		fetchImpl,
		timeoutMs,
	}: {
		clientId: string;
		fetchImpl: FetchImplementation;
		timeoutMs: number;
	}
) {
	let response: Response;
	try {
		response = await fetchImpl(`${IMGUR_API_BASE_URL}${pathname}`, {
			method: "GET",
			headers: {
				Accept: "application/json",
				Authorization: `Client-ID ${clientId}`,
			},
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw getFetchError(error);
	}
	if (!response.ok) throw getHttpError(response.status);

	let envelope: ImgurApiEnvelope;
	try {
		envelope = (await response.json()) as ImgurApiEnvelope;
	} catch {
		throw new ImgurApiError("IMGUR_INVALID_RESPONSE", "retryable");
	}
	if (!envelope || typeof envelope !== "object" || !("data" in envelope)) {
		throw new ImgurApiError("IMGUR_INVALID_RESPONSE", "retryable");
	}
	return envelope.data;
}

function requireObject(value: unknown): ImgurResource {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ImgurApiError("IMGUR_INVALID_RESPONSE", "retryable");
	}
	return value as ImgurResource;
}

async function fetchGalleryMetadata(
	id: string,
	options: {
		clientId: string;
		fetchImpl: FetchImplementation;
		timeoutMs: number;
	}
) {
	let album: ImgurResource;
	try {
		album = requireObject(await requestImgur(`/album/${id}`, options));
	} catch (error) {
		if (!(error instanceof ImgurApiError) || error.disposition !== "unavailable") throw error;
		return normalizeImage(requireObject(await requestImgur(`/image/${id}`, options)), "gallery");
	}

	const images = normalizeImages(await requestImgur(`/album/${id}/images`, options));
	return normalizeCollection(album, images, "gallery");
}

export async function fetchImgurMetadata(
	target: NormalizedImgurUrl,
	{
		clientId,
		fetchImpl = fetch,
		timeoutMs = 10_000,
	}: {
		clientId: string;
		fetchImpl?: FetchImplementation;
		timeoutMs?: number;
	}
): Promise<ImgurMetadataSummary> {
	if (!clientId.trim()) {
		throw new ImgurApiError("IMGUR_CLIENT_ID_MISSING", "terminal");
	}
	if (!target.externalId || target.failureReason) {
		throw new ImgurApiError("IMGUR_INVALID_TARGET", "terminal");
	}

	const options = { clientId, fetchImpl, timeoutMs };
	const id = target.externalId;
	if (target.kind === "image" || target.kind === "direct-file") {
		return normalizeImage(requireObject(await requestImgur(`/image/${id}`, options)));
	}
	if (target.kind === "album") {
		const album = requireObject(await requestImgur(`/album/${id}`, options));
		const images = normalizeImages(await requestImgur(`/album/${id}/images`, options));
		return normalizeCollection(album, images, "album");
	}
	if (target.kind === "gallery") {
		return fetchGalleryMetadata(id, options);
	}

	throw new ImgurApiError("IMGUR_UNSUPPORTED_URL", "terminal");
}
