import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaWorkerDiagnostics, MediaWorkerResult } from "@/contracts/media-worker.schema";
import {
	fetchImgurMetadata,
	getImgurCooldownFromDiagnostics,
	ImgurApiError,
	type ImgurApiRequestDiagnostics,
	type ImgurMetadataSummary,
	type ImgurRateLimitSnapshot,
} from "./client";
import { type NormalizedImgurUrl, normalizeImgurUrl } from "./url";

const IMGUR_LEASE_SECONDS = 60;
const IMGUR_MAX_ATTEMPTS = 5;
const IMGUR_RETRY_BASE_SECONDS = 60;
export const IMGUR_MAX_BATCH_SIZE = 2;
const IMGUR_WORKER_CONCURRENCY = 1;
const IMGUR_DIAGNOSTIC_KEY_LIMIT = 16;
const IMGUR_RATE_LIMIT_CODES = new Set([
	"IMGUR_CLIENT_QUOTA_EXHAUSTED",
	"IMGUR_USER_RATE_LIMITED",
	"IMGUR_HTTP_429",
]);

interface ClaimedImgurJob {
	thread_id: string | number;
	provider: "imgur";
	url: string;
	attempt_count: number;
	lease_token: string;
	lease_expires_at: string;
}

interface PreparedImgurJob {
	job: ClaimedImgurJob;
	target: NormalizedImgurUrl;
}

interface ActiveCooldown {
	code: string;
	until: string;
	rateLimit: ImgurRateLimitSnapshot | null;
}

export type ImgurWorkerResult = MediaWorkerResult & {
	diagnostics: MediaWorkerDiagnostics;
};

export class ImgurWorkerError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = "ImgurWorkerError";
	}
}

function createEmptyResult(): ImgurWorkerResult {
	return {
		claimedCount: 0,
		readyCount: 0,
		unavailableCount: 0,
		unsupportedCount: 0,
		retriedCount: 0,
		failedCount: 0,
		leaseRejectedCount: 0,
		diagnostics: {
			providerOutcome: "idle",
			apiRequestCount: 0,
			rateLimitedCount: 0,
			errorCounts: {},
			httpStatusCounts: {},
			nextAvailableAt: null,
			cooldownUntil: null,
			rateLimit: null,
		},
	};
}

function getRetryDelaySeconds(attemptCount: number) {
	return Math.min(IMGUR_RETRY_BASE_SECONDS * 2 ** Math.max(0, attemptCount - 1), 3_600);
}

function incrementDiagnosticCount(counts: Record<string, number>, key: string, increment = 1) {
	if (!(key in counts) && Object.keys(counts).length >= IMGUR_DIAGNOSTIC_KEY_LIMIT) return;
	counts[key] = (counts[key] ?? 0) + increment;
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

function mergeApiDiagnostics(result: ImgurWorkerResult, diagnostics: ImgurApiRequestDiagnostics) {
	result.diagnostics.apiRequestCount += diagnostics.apiRequestCount;
	for (const [status, count] of Object.entries(diagnostics.httpStatusCounts)) {
		incrementDiagnosticCount(result.diagnostics.httpStatusCounts, status, count);
	}
	result.diagnostics.rateLimit = mergeRateLimitSnapshots(
		result.diagnostics.rateLimit,
		diagnostics.rateLimit
	);
}

function getErrorDiagnostics(error: ImgurApiError): ImgurApiRequestDiagnostics {
	return {
		apiRequestCount: error.apiRequestCount,
		httpStatusCounts: error.httpStatusCounts,
		rateLimit: error.rateLimit,
	};
}

function recordError(result: ImgurWorkerResult, errorCode: string) {
	incrementDiagnosticCount(result.diagnostics.errorCounts, errorCode);
}

function recordNextAvailableAt(result: ImgurWorkerResult, availableAt: string) {
	if (
		result.diagnostics.nextAvailableAt === null ||
		availableAt < result.diagnostics.nextAvailableAt
	) {
		result.diagnostics.nextAvailableAt = availableAt;
	}
}

async function invokeLeaseRpc(
	supabase: SupabaseClient,
	name:
		| "complete_media_enrichment_job"
		| "retry_media_enrichment_job"
		| "fail_media_enrichment_job",
	parameters: Record<string, unknown>,
	result: ImgurWorkerResult,
	counter: "readyCount" | "unavailableCount" | "unsupportedCount" | "retriedCount" | "failedCount"
) {
	const { data, error } = await supabase.rpc(name, parameters);
	if (error) throw new ImgurWorkerError("IMGUR_QUEUE_RPC_FAILED");
	if (data !== true) {
		result.leaseRejectedCount += 1;
		return false;
	}
	result[counter] += 1;
	return true;
}

function completeJob(
	supabase: SupabaseClient,
	prepared: PreparedImgurJob,
	metadata: ImgurMetadataSummary,
	result: ImgurWorkerResult
) {
	return invokeLeaseRpc(
		supabase,
		"complete_media_enrichment_job",
		{
			p_thread_id: prepared.job.thread_id,
			p_lease_token: prepared.job.lease_token,
			p_metadata: {
				status: "ready",
				external_id: prepared.target.externalId,
				media_kind: metadata.mediaKind,
				title: metadata.title,
				channel_title: null,
				thumbnail_url: metadata.thumbnailUrl,
				duration_seconds: null,
				live_status: null,
				media_count: metadata.mediaCount,
				preview_urls: metadata.previewUrls,
				last_error_code: null,
			},
		},
		result,
		"readyCount"
	);
}

function completeUnavailableJob(
	supabase: SupabaseClient,
	prepared: PreparedImgurJob,
	errorCode: string,
	result: ImgurWorkerResult
) {
	return invokeLeaseRpc(
		supabase,
		"complete_media_enrichment_job",
		{
			p_thread_id: prepared.job.thread_id,
			p_lease_token: prepared.job.lease_token,
			p_metadata: {
				status: "unavailable",
				external_id: prepared.target.externalId,
				media_kind: prepared.target.mediaKind,
				title: null,
				channel_title: null,
				thumbnail_url: null,
				duration_seconds: null,
				live_status: null,
				media_count: null,
				preview_urls: [],
				last_error_code: errorCode,
			},
		},
		result,
		"unavailableCount"
	);
}

function completeUnsupportedJob(
	supabase: SupabaseClient,
	job: ClaimedImgurJob,
	result: ImgurWorkerResult
) {
	return invokeLeaseRpc(
		supabase,
		"complete_media_enrichment_job",
		{
			p_thread_id: job.thread_id,
			p_lease_token: job.lease_token,
			p_metadata: {
				status: "unsupported",
				external_id: null,
				media_kind: "unsupported",
				title: null,
				channel_title: null,
				thumbnail_url: null,
				duration_seconds: null,
				live_status: null,
				media_count: null,
				preview_urls: [],
				last_error_code: "IMGUR_UNSUPPORTED_URL",
			},
		},
		result,
		"unsupportedCount"
	);
}

function failJob(
	supabase: SupabaseClient,
	job: ClaimedImgurJob,
	errorCode: string,
	result: ImgurWorkerResult
) {
	return invokeLeaseRpc(
		supabase,
		"fail_media_enrichment_job",
		{
			p_thread_id: job.thread_id,
			p_lease_token: job.lease_token,
			p_error_code: errorCode,
		},
		result,
		"failedCount"
	);
}

async function retryJobAt(
	supabase: SupabaseClient,
	job: ClaimedImgurJob,
	errorCode: string,
	availableAt: string,
	result: ImgurWorkerResult
) {
	const accepted = await invokeLeaseRpc(
		supabase,
		"retry_media_enrichment_job",
		{
			p_thread_id: job.thread_id,
			p_lease_token: job.lease_token,
			p_error_code: errorCode,
			p_available_at: availableAt,
		},
		result,
		"retriedCount"
	);
	if (accepted) recordNextAvailableAt(result, availableAt);
	return accepted;
}

function retryTransientJob(
	supabase: SupabaseClient,
	job: ClaimedImgurJob,
	error: ImgurApiError,
	now: Date,
	result: ImgurWorkerResult
) {
	if (job.attempt_count >= IMGUR_MAX_ATTEMPTS) {
		return failJob(supabase, job, error.code, result);
	}
	const availableAt = new Date(
		now.getTime() + getRetryDelaySeconds(job.attempt_count) * 1_000
	).toISOString();
	return retryJobAt(supabase, job, error.code, availableAt, result);
}

async function setProviderCooldown(
	supabase: SupabaseClient,
	code: string,
	retryAfterSeconds: number,
	rateLimit: ImgurRateLimitSnapshot | null,
	now: Date,
	result: ImgurWorkerResult
) {
	const until = new Date(now.getTime() + retryAfterSeconds * 1_000).toISOString();
	const { data, error } = await supabase.rpc("set_imgur_enrichment_cooldown", {
		p_until: until,
		p_error_code: code,
	});
	if (error || data !== true) {
		throw new ImgurWorkerError("IMGUR_COOLDOWN_RPC_FAILED");
	}
	result.diagnostics.cooldownUntil = until;
	result.diagnostics.rateLimit = mergeRateLimitSnapshots(result.diagnostics.rateLimit, rateLimit);
	return { code, until, rateLimit } satisfies ActiveCooldown;
}

function validateClaimedJobs(value: unknown): ClaimedImgurJob[] {
	if (!Array.isArray(value)) throw new ImgurWorkerError("IMGUR_INVALID_CLAIM_RESPONSE");
	return value.map((job) => {
		if (
			!job ||
			typeof job !== "object" ||
			(job as ClaimedImgurJob).provider !== "imgur" ||
			typeof (job as ClaimedImgurJob).url !== "string" ||
			typeof (job as ClaimedImgurJob).lease_token !== "string" ||
			typeof (job as ClaimedImgurJob).attempt_count !== "number"
		) {
			throw new ImgurWorkerError("IMGUR_INVALID_CLAIM_RESPONSE");
		}
		return job as ClaimedImgurJob;
	});
}

function finalizeProviderOutcome(result: ImgurWorkerResult) {
	const {
		claimedCount,
		readyCount,
		unavailableCount,
		unsupportedCount,
		retriedCount,
		failedCount,
	} = result;
	if (claimedCount === 0) {
		result.diagnostics.providerOutcome = "idle";
	} else if (result.diagnostics.rateLimitedCount === claimedCount) {
		result.diagnostics.providerOutcome = "rate-limited";
	} else if (failedCount === claimedCount) {
		result.diagnostics.providerOutcome = "failed";
	} else if (retriedCount === claimedCount) {
		result.diagnostics.providerOutcome = "retrying";
	} else if (readyCount + unavailableCount + unsupportedCount === claimedCount) {
		result.diagnostics.providerOutcome = "completed";
	} else {
		result.diagnostics.providerOutcome = "partial";
	}
}

async function deferForCooldown(
	supabase: SupabaseClient,
	job: ClaimedImgurJob,
	cooldown: ActiveCooldown,
	result: ImgurWorkerResult
) {
	recordError(result, cooldown.code);
	result.diagnostics.rateLimitedCount += 1;
	await retryJobAt(supabase, job, cooldown.code, cooldown.until, result);
}

async function prepareClaimedJobs(
	supabase: SupabaseClient,
	jobs: ClaimedImgurJob[],
	result: ImgurWorkerResult
) {
	const prepared: PreparedImgurJob[] = [];
	for (const job of jobs) {
		const target = normalizeImgurUrl(job.url);
		if (target.failureReason === "invalid-id") {
			recordError(result, "IMGUR_INVALID_ID");
			await failJob(supabase, job, "IMGUR_INVALID_ID", result);
		} else if (!target.externalId) {
			await completeUnsupportedJob(supabase, job, result);
		} else {
			prepared.push({ job, target });
		}
	}
	return prepared;
}

async function handleApiError(
	supabase: SupabaseClient,
	preparedJob: PreparedImgurJob,
	error: unknown,
	requestNow: Date,
	result: ImgurWorkerResult
): Promise<ActiveCooldown | null> {
	const apiError =
		error instanceof ImgurApiError ? error : new ImgurApiError("IMGUR_NETWORK", "retryable");
	mergeApiDiagnostics(result, getErrorDiagnostics(apiError));
	recordError(result, apiError.code);

	if (apiError.disposition === "unavailable") {
		await completeUnavailableJob(supabase, preparedJob, apiError.code, result);
		return null;
	}
	if (apiError.disposition === "terminal") {
		await failJob(supabase, preparedJob.job, apiError.code, result);
		return null;
	}
	if (!IMGUR_RATE_LIMIT_CODES.has(apiError.code) || apiError.retryAfterSeconds === null) {
		await retryTransientJob(supabase, preparedJob.job, apiError, requestNow, result);
		return null;
	}

	result.diagnostics.rateLimitedCount += 1;
	const cooldown = await setProviderCooldown(
		supabase,
		apiError.code,
		apiError.retryAfterSeconds,
		apiError.rateLimit,
		requestNow,
		result
	);
	await retryJobAt(supabase, preparedJob.job, apiError.code, cooldown.until, result);
	return cooldown;
}

async function processPreparedJob(
	supabase: SupabaseClient,
	preparedJob: PreparedImgurJob,
	options: {
		clientId: string;
		fetchImpl: typeof fetch;
		timeoutMs: number;
		now: () => Date;
	},
	result: ImgurWorkerResult
): Promise<ActiveCooldown | null> {
	const requestNow = options.now();
	let fetched: Awaited<ReturnType<typeof fetchImgurMetadata>>;
	try {
		fetched = await fetchImgurMetadata(preparedJob.target, {
			clientId: options.clientId,
			fetchImpl: options.fetchImpl,
			timeoutMs: options.timeoutMs,
			now: () => requestNow,
		});
	} catch (error) {
		return handleApiError(supabase, preparedJob, error, requestNow, result);
	}

	mergeApiDiagnostics(result, fetched.diagnostics);
	await completeJob(supabase, preparedJob, fetched.metadata, result);

	const cooldown = getImgurCooldownFromDiagnostics(fetched.diagnostics, requestNow);
	if (!cooldown) return null;

	recordError(result, cooldown.code);
	result.diagnostics.rateLimitedCount += 1;
	return setProviderCooldown(
		supabase,
		cooldown.code,
		cooldown.retryAfterSeconds,
		fetched.diagnostics.rateLimit,
		requestNow,
		result
	);
}

async function processPreparedJobs(
	supabase: SupabaseClient,
	prepared: PreparedImgurJob[],
	options: {
		clientId: string;
		fetchImpl: typeof fetch;
		timeoutMs: number;
		now: () => Date;
	},
	result: ImgurWorkerResult
) {
	let activeCooldown: ActiveCooldown | null = null;
	for (const preparedJob of prepared) {
		if (activeCooldown) {
			await deferForCooldown(supabase, preparedJob.job, activeCooldown, result);
		} else {
			activeCooldown = await processPreparedJob(supabase, preparedJob, options, result);
		}
	}
}

export async function runImgurEnrichmentWorker(
	supabase: SupabaseClient,
	{
		clientId,
		limit = IMGUR_MAX_BATCH_SIZE,
		concurrency = IMGUR_WORKER_CONCURRENCY,
		fetchImpl = fetch,
		timeoutMs = 10_000,
		now = () => new Date(),
	}: {
		clientId: string;
		limit?: number;
		concurrency?: number;
		fetchImpl?: typeof fetch;
		timeoutMs?: number;
		now?: () => Date;
	}
): Promise<ImgurWorkerResult> {
	if (!clientId.trim()) throw new ImgurWorkerError("IMGUR_CLIENT_ID_MISSING");
	if (!Number.isInteger(limit) || limit < 1 || limit > IMGUR_MAX_BATCH_SIZE) {
		throw new ImgurWorkerError("IMGUR_INVALID_LIMIT");
	}
	if (concurrency !== IMGUR_WORKER_CONCURRENCY) {
		throw new ImgurWorkerError("IMGUR_INVALID_CONCURRENCY");
	}

	const { data, error } = await supabase.rpc("claim_media_enrichment_jobs", {
		p_provider: "imgur",
		p_limit: limit,
		p_lease_seconds: IMGUR_LEASE_SECONDS,
	});
	if (error) throw new ImgurWorkerError("IMGUR_CLAIM_FAILED");

	const jobs = validateClaimedJobs(data ?? []);
	if (jobs.length > limit) throw new ImgurWorkerError("IMGUR_INVALID_CLAIM_RESPONSE");
	const result = createEmptyResult();
	result.claimedCount = jobs.length;
	if (jobs.length === 0) return result;

	const prepared = await prepareClaimedJobs(supabase, jobs, result);
	await processPreparedJobs(supabase, prepared, { clientId, fetchImpl, timeoutMs, now }, result);

	finalizeProviderOutcome(result);
	return result;
}
