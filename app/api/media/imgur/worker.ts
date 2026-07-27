import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchImgurMetadata, ImgurApiError, type ImgurMetadataSummary } from "./client";
import { type NormalizedImgurUrl, normalizeImgurUrl } from "./url";

const IMGUR_LEASE_SECONDS = 60;
const IMGUR_MAX_ATTEMPTS = 5;
const IMGUR_RETRY_BASE_SECONDS = 60;
export const IMGUR_MAX_BATCH_SIZE = 4;
const IMGUR_WORKER_CONCURRENCY = 4;

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

export interface ImgurWorkerResult {
	claimedCount: number;
	readyCount: number;
	unavailableCount: number;
	unsupportedCount: number;
	retriedCount: number;
	failedCount: number;
	leaseRejectedCount: number;
}

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
	};
}

function getRetryDelaySeconds(attemptCount: number) {
	return Math.min(IMGUR_RETRY_BASE_SECONDS * 2 ** Math.max(0, attemptCount - 1), 3_600);
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

function retryJob(
	supabase: SupabaseClient,
	job: ClaimedImgurJob,
	errorCode: string,
	now: () => Date,
	result: ImgurWorkerResult
) {
	if (job.attempt_count >= IMGUR_MAX_ATTEMPTS) {
		return failJob(supabase, job, "IMGUR_MAX_ATTEMPTS", result);
	}
	return invokeLeaseRpc(
		supabase,
		"retry_media_enrichment_job",
		{
			p_thread_id: job.thread_id,
			p_lease_token: job.lease_token,
			p_error_code: errorCode,
			p_available_at: new Date(
				now().getTime() + getRetryDelaySeconds(job.attempt_count) * 1_000
			).toISOString(),
		},
		result,
		"retriedCount"
	);
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

async function mapWithConcurrency<T>(
	values: readonly T[],
	concurrency: number,
	operation: (value: T) => Promise<void>
) {
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
		while (nextIndex < values.length) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			await operation(values[currentIndex]);
		}
	});
	await Promise.all(workers);
}

async function processPreparedJob(
	supabase: SupabaseClient,
	prepared: PreparedImgurJob,
	options: {
		clientId: string;
		fetchImpl: typeof fetch;
		timeoutMs: number;
		now: () => Date;
	},
	result: ImgurWorkerResult
) {
	try {
		const metadata = await fetchImgurMetadata(prepared.target, options);
		await completeJob(supabase, prepared, metadata, result);
	} catch (error) {
		const apiError =
			error instanceof ImgurApiError ? error : new ImgurApiError("IMGUR_NETWORK", "retryable");
		if (apiError.disposition === "unavailable") {
			await completeUnavailableJob(supabase, prepared, apiError.code, result);
		} else if (apiError.disposition === "retryable") {
			await retryJob(supabase, prepared.job, apiError.code, options.now, result);
		} else {
			await failJob(supabase, prepared.job, apiError.code, result);
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
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > IMGUR_WORKER_CONCURRENCY) {
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

	const prepared: PreparedImgurJob[] = [];
	for (const job of jobs) {
		const target = normalizeImgurUrl(job.url);
		if (target.failureReason === "invalid-id") {
			await failJob(supabase, job, "IMGUR_INVALID_ID", result);
		} else if (!target.externalId) {
			await completeUnsupportedJob(supabase, job, result);
		} else {
			prepared.push({ job, target });
		}
	}

	await mapWithConcurrency(prepared, concurrency, (job) =>
		processPreparedJob(supabase, job, { clientId, fetchImpl, timeoutMs, now }, result)
	);
	return result;
}
