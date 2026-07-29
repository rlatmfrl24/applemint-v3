import { getAllowedMediaUrl, isVideoMediaUrl } from "@/lib/media-preview";
import type { NormalizedImgurUrl } from "./url";

const IMGUR_API_BASE_URL = "https://api.imgur.com/3";
const IMGUR_PREVIEW_LIMIT = 4;
const IMGUR_CLIENT_QUOTA_RETRY_SECONDS = 25 * 60 * 60;
const IMGUR_USER_RATE_LIMIT_RETRY_SECONDS = 65 * 60;
const IMGUR_GENERIC_RATE_LIMIT_RETRY_SECONDS = 60 * 60;
const IMGUR_MIN_RETRY_AFTER_SECONDS = 60;
const IMGUR_MAX_RETRY_AFTER_SECONDS = IMGUR_CLIENT_QUOTA_RETRY_SECONDS;

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
	images?: unknown;
}

export interface ImgurMetadataSummary {
	title: string | null;
	mediaKind: "image" | "video" | "album" | "gallery";
	thumbnailUrl: string | null;
	mediaCount: number;
	previewUrls: string[];
}

export interface ImgurRateLimitSnapshot {
	clientRemaining: number | null;
	userRemaining: number | null;
	userResetAt: string | null;
}

export interface ImgurApiRequestDiagnostics {
	apiRequestCount: number;
	httpStatusCounts: Record<string, number>;
	rateLimit: ImgurRateLimitSnapshot | null;
}

export interface ImgurMetadataFetchResult {
	metadata: ImgurMetadataSummary;
	diagnostics: ImgurApiRequestDiagnostics;
}

interface ImgurRequestContext extends ImgurApiRequestDiagnostics {
	now: () => Date;
}

interface ImgurApiErrorOptions {
	httpStatus?: number | null;
	retryAfterSeconds?: number | null;
	diagnostics?: ImgurApiRequestDiagnostics;
}

export class ImgurApiError extends Error {
	readonly httpStatus: number | null;
	readonly retryAfterSeconds: number | null;
	readonly apiRequestCount: number;
	readonly httpStatusCounts: Record<string, number>;
	readonly rateLimit: ImgurRateLimitSnapshot | null;

	constructor(
		readonly code: string,
		readonly disposition: ImgurApiErrorDisposition,
		options: ImgurApiErrorOptions = {}
	) {
		super(code);
		this.name = "ImgurApiError";
		this.httpStatus = options.httpStatus ?? null;
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
		this.apiRequestCount = options.diagnostics?.apiRequestCount ?? 0;
		this.httpStatusCounts = { ...(options.diagnostics?.httpStatusCounts ?? {}) };
		this.rateLimit = options.diagnostics?.rateLimit ?? null;
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

function normalizeImages(value: unknown, context: ImgurRequestContext) {
	if (!Array.isArray(value)) {
		throw createApiError(context, "IMGUR_INVALID_RESPONSE", "retryable");
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

function getHeaderInteger(headers: Headers, name: string) {
	const value = headers.get(name)?.trim();
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function clampCooldownSeconds(seconds: number) {
	return Math.min(
		Math.max(Math.ceil(seconds), IMGUR_MIN_RETRY_AFTER_SECONDS),
		IMGUR_MAX_RETRY_AFTER_SECONDS
	);
}

function getRetryAfterSeconds(headers: Headers, now: Date) {
	const value = headers.get("retry-after")?.trim();
	if (!value) return null;
	if (/^\d+$/.test(value)) {
		const seconds = Number(value);
		return Number.isSafeInteger(seconds) ? clampCooldownSeconds(seconds) : null;
	}
	const retryAt = Date.parse(value);
	if (!Number.isFinite(retryAt)) return null;
	return clampCooldownSeconds((retryAt - now.getTime()) / 1_000);
}

function getUserResetAt(headers: Headers, now: Date) {
	const seconds = getHeaderInteger(headers, "x-ratelimit-userreset");
	if (seconds === null) return null;
	const resetAt = seconds * 1_000;
	if (!Number.isSafeInteger(resetAt) || resetAt <= now.getTime()) return null;
	try {
		return new Date(resetAt).toISOString();
	} catch {
		return null;
	}
}

function getResponseRateLimitSnapshot(headers: Headers, now: Date): ImgurRateLimitSnapshot | null {
	const snapshot = {
		clientRemaining: getHeaderInteger(headers, "x-ratelimit-clientremaining"),
		userRemaining: getHeaderInteger(headers, "x-ratelimit-userremaining"),
		userResetAt: getUserResetAt(headers, now),
	};
	return Object.values(snapshot).some((value) => value !== null) ? snapshot : null;
}

function getMinimumInteger(left: number | null, right: number | null) {
	if (left === null) return right;
	if (right === null) return left;
	return Math.min(left, right);
}

function mergeRateLimitSnapshots(
	current: ImgurRateLimitSnapshot | null,
	next: ImgurRateLimitSnapshot | null
) {
	if (!current) return next;
	if (!next) return current;
	return {
		clientRemaining: getMinimumInteger(current.clientRemaining, next.clientRemaining),
		userRemaining: getMinimumInteger(current.userRemaining, next.userRemaining),
		userResetAt: next.userResetAt ?? current.userResetAt,
	};
}

function copyDiagnostics(context: ImgurRequestContext): ImgurApiRequestDiagnostics {
	return {
		apiRequestCount: context.apiRequestCount,
		httpStatusCounts: { ...context.httpStatusCounts },
		rateLimit: context.rateLimit ? { ...context.rateLimit } : null,
	};
}

function recordResponse(context: ImgurRequestContext, response: Response) {
	const key = String(response.status);
	context.httpStatusCounts[key] = (context.httpStatusCounts[key] ?? 0) + 1;
	context.rateLimit = mergeRateLimitSnapshots(
		context.rateLimit,
		getResponseRateLimitSnapshot(response.headers, context.now())
	);
}

function getUserRetrySeconds(rateLimit: ImgurRateLimitSnapshot, now: Date) {
	if (!rateLimit.userResetAt) return IMGUR_USER_RATE_LIMIT_RETRY_SECONDS;
	const resetAt = Date.parse(rateLimit.userResetAt);
	if (!Number.isFinite(resetAt) || resetAt <= now.getTime()) {
		return IMGUR_USER_RATE_LIMIT_RETRY_SECONDS;
	}
	return clampCooldownSeconds((resetAt + 5 * 60 * 1_000 - now.getTime()) / 1_000);
}

export function getImgurCooldownFromDiagnostics(
	diagnostics: ImgurApiRequestDiagnostics,
	now: Date
) {
	if (diagnostics.rateLimit?.clientRemaining === 0) {
		return {
			code: "IMGUR_CLIENT_QUOTA_EXHAUSTED",
			retryAfterSeconds: IMGUR_CLIENT_QUOTA_RETRY_SECONDS,
		};
	}
	if (diagnostics.rateLimit?.userRemaining === 0) {
		return {
			code: "IMGUR_USER_RATE_LIMITED",
			retryAfterSeconds: getUserRetrySeconds(diagnostics.rateLimit, now),
		};
	}
	return null;
}

function createApiError(
	context: ImgurRequestContext,
	code: string,
	disposition: ImgurApiErrorDisposition,
	options: Omit<ImgurApiErrorOptions, "diagnostics"> = {}
) {
	return new ImgurApiError(code, disposition, {
		...options,
		diagnostics: copyDiagnostics(context),
	});
}

function getHttpError(response: Response, context: ImgurRequestContext) {
	const { status } = response;
	if (status === 404) {
		return createApiError(context, "IMGUR_HTTP_404", "unavailable", { httpStatus: status });
	}
	const quotaError = getImgurCooldownFromDiagnostics(copyDiagnostics(context), context.now());
	if (status === 429 || (status === 403 && quotaError)) {
		if (quotaError?.code === "IMGUR_CLIENT_QUOTA_EXHAUSTED") {
			return createApiError(context, "IMGUR_CLIENT_QUOTA_EXHAUSTED", "retryable", {
				httpStatus: status,
				retryAfterSeconds: quotaError.retryAfterSeconds,
			});
		}
		if (quotaError?.code === "IMGUR_USER_RATE_LIMITED") {
			return createApiError(context, "IMGUR_USER_RATE_LIMITED", "retryable", {
				httpStatus: status,
				retryAfterSeconds: quotaError.retryAfterSeconds,
			});
		}
		return createApiError(context, "IMGUR_HTTP_429", "retryable", {
			httpStatus: status,
			retryAfterSeconds:
				getRetryAfterSeconds(response.headers, context.now()) ??
				IMGUR_GENERIC_RATE_LIMIT_RETRY_SECONDS,
		});
	}
	if (status >= 500) {
		return createApiError(context, "IMGUR_HTTP_5XX", "retryable", { httpStatus: status });
	}
	if (status === 403) {
		return createApiError(context, "IMGUR_HTTP_403", "terminal", { httpStatus: status });
	}
	if (status >= 400 && status < 500) {
		return createApiError(context, "IMGUR_HTTP_4XX", "terminal", { httpStatus: status });
	}
	return createApiError(context, "IMGUR_HTTP_ERROR", "terminal", { httpStatus: status });
}

function getFetchError(error: unknown, context: ImgurRequestContext) {
	if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
		return createApiError(context, "IMGUR_TIMEOUT", "retryable");
	}
	return createApiError(context, "IMGUR_NETWORK", "retryable");
}

async function requestImgur(
	pathname: string,
	{
		clientId,
		fetchImpl,
		timeoutMs,
		context,
	}: {
		clientId: string;
		fetchImpl: FetchImplementation;
		timeoutMs: number;
		context: ImgurRequestContext;
	}
) {
	let response: Response;
	context.apiRequestCount += 1;
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
		throw getFetchError(error, context);
	}
	recordResponse(context, response);
	if (!response.ok) throw getHttpError(response, context);

	let envelope: ImgurApiEnvelope;
	try {
		envelope = (await response.json()) as ImgurApiEnvelope;
	} catch {
		throw createApiError(context, "IMGUR_INVALID_RESPONSE", "retryable", {
			httpStatus: response.status,
		});
	}
	if (!envelope || typeof envelope !== "object" || !("data" in envelope)) {
		throw createApiError(context, "IMGUR_INVALID_RESPONSE", "retryable", {
			httpStatus: response.status,
		});
	}
	return envelope.data;
}

async function getCollectionImages(
	resource: ImgurResource,
	id: string,
	options: {
		clientId: string;
		fetchImpl: FetchImplementation;
		timeoutMs: number;
		context: ImgurRequestContext;
	}
) {
	if (Array.isArray(resource.images)) return normalizeImages(resource.images, options.context);
	if (getImgurCooldownFromDiagnostics(copyDiagnostics(options.context), options.context.now())) {
		return [];
	}
	return normalizeImages(await requestImgur(`/album/${id}/images`, options), options.context);
}

function requireObject(value: unknown, context: ImgurRequestContext): ImgurResource {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw createApiError(context, "IMGUR_INVALID_RESPONSE", "retryable");
	}
	return value as ImgurResource;
}

async function fetchGalleryMetadata(
	id: string,
	options: {
		clientId: string;
		fetchImpl: FetchImplementation;
		timeoutMs: number;
		context: ImgurRequestContext;
	}
) {
	let album: ImgurResource;
	try {
		album = requireObject(await requestImgur(`/album/${id}`, options), options.context);
	} catch (error) {
		if (!(error instanceof ImgurApiError) || error.disposition !== "unavailable") throw error;
		if (getImgurCooldownFromDiagnostics(copyDiagnostics(options.context), options.context.now())) {
			throw error;
		}
		return normalizeImage(
			requireObject(await requestImgur(`/image/${id}`, options), options.context),
			"gallery"
		);
	}

	const images = await getCollectionImages(album, id, options);
	return normalizeCollection(album, images, "gallery");
}

export async function fetchImgurMetadata(
	target: NormalizedImgurUrl,
	{
		clientId,
		fetchImpl = fetch,
		timeoutMs = 10_000,
		now = () => new Date(),
	}: {
		clientId: string;
		fetchImpl?: FetchImplementation;
		timeoutMs?: number;
		now?: () => Date;
	}
): Promise<ImgurMetadataFetchResult> {
	if (!clientId.trim()) {
		throw new ImgurApiError("IMGUR_CLIENT_ID_MISSING", "terminal");
	}
	if (!target.externalId || target.failureReason) {
		throw new ImgurApiError("IMGUR_INVALID_TARGET", "terminal");
	}

	const context: ImgurRequestContext = {
		apiRequestCount: 0,
		httpStatusCounts: {},
		rateLimit: null,
		now,
	};
	const options = { clientId, fetchImpl, timeoutMs, context };
	const id = target.externalId;
	let metadata: ImgurMetadataSummary;
	if (target.kind === "image" || target.kind === "direct-file") {
		metadata = normalizeImage(
			requireObject(await requestImgur(`/image/${id}`, options), options.context)
		);
	} else if (target.kind === "album") {
		const album = requireObject(await requestImgur(`/album/${id}`, options), options.context);
		const images = await getCollectionImages(album, id, options);
		metadata = normalizeCollection(album, images, "album");
	} else if (target.kind === "gallery") {
		metadata = await fetchGalleryMetadata(id, options);
	} else {
		throw new ImgurApiError("IMGUR_UNSUPPORTED_URL", "terminal");
	}
	return {
		metadata,
		diagnostics: copyDiagnostics(context),
	};
}
