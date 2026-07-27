import type { SupabaseClient } from "@supabase/supabase-js";
import { type NormalizedYouTubeUrl, normalizeYouTubeUrl } from "./url";
import {
	listYouTubeVideos,
	YOUTUBE_MAX_BATCH_SIZE,
	YouTubeApiError,
	type YouTubeVideoResult,
} from "./videos-list";

const YOUTUBE_LEASE_SECONDS = 45;
const YOUTUBE_MAX_ATTEMPTS = 5;
const YOUTUBE_RETRY_BASE_SECONDS = 60;

interface ClaimedYouTubeJob {
	thread_id: string | number;
	provider: "youtube";
	url: string;
	attempt_count: number;
	lease_token: string;
	lease_expires_at: string;
}

interface PreparedYouTubeJob {
	job: ClaimedYouTubeJob;
	target: NormalizedYouTubeUrl;
}

export interface YouTubeWorkerResult {
	claimedCount: number;
	readyCount: number;
	unavailableCount: number;
	unsupportedCount: number;
	retriedCount: number;
	failedCount: number;
	leaseRejectedCount: number;
}

export class YouTubeWorkerError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = "YouTubeWorkerError";
	}
}

function createEmptyResult(): YouTubeWorkerResult {
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
	return Math.min(YOUTUBE_RETRY_BASE_SECONDS * 2 ** Math.max(0, attemptCount - 1), 3_600);
}

function getMediaKind(target: NormalizedYouTubeUrl, video: YouTubeVideoResult) {
	if (target.mediaKind === "short") return "short";
	if ("liveStatus" in video && (video.liveStatus === "live" || video.liveStatus === "upcoming")) {
		return "live";
	}
	return target.mediaKind === "live" ? "live" : "video";
}

async function invokeLeaseRpc(
	supabase: SupabaseClient,
	name:
		| "complete_media_enrichment_job"
		| "retry_media_enrichment_job"
		| "fail_media_enrichment_job",
	parameters: Record<string, unknown>,
	result: YouTubeWorkerResult,
	counter: "readyCount" | "unavailableCount" | "unsupportedCount" | "retriedCount" | "failedCount"
) {
	const { data, error } = await supabase.rpc(name, parameters);
	if (error) throw new YouTubeWorkerError("YOUTUBE_QUEUE_RPC_FAILED");
	if (data !== true) {
		result.leaseRejectedCount += 1;
		return false;
	}
	result[counter] += 1;
	return true;
}

function completeUnsupportedJob(
	supabase: SupabaseClient,
	job: ClaimedYouTubeJob,
	result: YouTubeWorkerResult
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
				preview_urls: [],
				last_error_code: "YOUTUBE_UNSUPPORTED_URL",
			},
		},
		result,
		"unsupportedCount"
	);
}

function failJob(
	supabase: SupabaseClient,
	job: ClaimedYouTubeJob,
	errorCode: string,
	result: YouTubeWorkerResult
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

function completeUnavailableJob(
	supabase: SupabaseClient,
	prepared: PreparedYouTubeJob,
	result: YouTubeWorkerResult
) {
	return invokeLeaseRpc(
		supabase,
		"complete_media_enrichment_job",
		{
			p_thread_id: prepared.job.thread_id,
			p_lease_token: prepared.job.lease_token,
			p_metadata: {
				status: "unavailable",
				external_id: prepared.target.videoId,
				media_kind: prepared.target.mediaKind,
				title: null,
				channel_title: null,
				thumbnail_url: null,
				duration_seconds: null,
				live_status: null,
				preview_urls: [],
				last_error_code: "YOUTUBE_NOT_RETURNED",
			},
		},
		result,
		"unavailableCount"
	);
}

function completeReadyJob(
	supabase: SupabaseClient,
	prepared: PreparedYouTubeJob,
	video: YouTubeVideoResult,
	result: YouTubeWorkerResult
) {
	if (!("liveStatus" in video)) {
		return failJob(supabase, prepared.job, video.errorCode, result);
	}
	return invokeLeaseRpc(
		supabase,
		"complete_media_enrichment_job",
		{
			p_thread_id: prepared.job.thread_id,
			p_lease_token: prepared.job.lease_token,
			p_metadata: {
				status: "ready",
				external_id: video.id,
				media_kind: getMediaKind(prepared.target, video),
				title: video.title,
				channel_title: video.channelTitle,
				thumbnail_url: video.thumbnailUrl,
				duration_seconds: video.durationSeconds,
				live_status: video.liveStatus,
				preview_urls: [],
				last_error_code: null,
			},
		},
		result,
		"readyCount"
	);
}

function retryJob(
	supabase: SupabaseClient,
	job: ClaimedYouTubeJob,
	errorCode: string,
	now: () => Date,
	result: YouTubeWorkerResult
) {
	if (job.attempt_count >= YOUTUBE_MAX_ATTEMPTS) {
		return failJob(supabase, job, "YOUTUBE_MAX_ATTEMPTS", result);
	}
	const availableAt = new Date(
		now().getTime() + getRetryDelaySeconds(job.attempt_count) * 1_000
	).toISOString();
	return invokeLeaseRpc(
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
}

function validateClaimedJobs(value: unknown): ClaimedYouTubeJob[] {
	if (!Array.isArray(value)) throw new YouTubeWorkerError("YOUTUBE_INVALID_CLAIM_RESPONSE");
	return value.map((job) => {
		if (
			!job ||
			typeof job !== "object" ||
			(job as ClaimedYouTubeJob).provider !== "youtube" ||
			typeof (job as ClaimedYouTubeJob).url !== "string" ||
			typeof (job as ClaimedYouTubeJob).lease_token !== "string" ||
			typeof (job as ClaimedYouTubeJob).attempt_count !== "number"
		) {
			throw new YouTubeWorkerError("YOUTUBE_INVALID_CLAIM_RESPONSE");
		}
		return job as ClaimedYouTubeJob;
	});
}

async function prepareApiJobs(
	supabase: SupabaseClient,
	jobs: ClaimedYouTubeJob[],
	result: YouTubeWorkerResult
) {
	const apiJobs: PreparedYouTubeJob[] = [];
	for (const job of jobs) {
		const prepared = { job, target: normalizeYouTubeUrl(job.url) };
		if (prepared.target.failureReason === "invalid-video-id") {
			await failJob(supabase, job, "YOUTUBE_INVALID_VIDEO_ID", result);
		} else if (!prepared.target.videoId) {
			await completeUnsupportedJob(supabase, job, result);
		} else {
			apiJobs.push(prepared);
		}
	}
	return apiJobs;
}

function normalizeApiError(error: unknown) {
	return error instanceof YouTubeApiError
		? error
		: new YouTubeApiError("YOUTUBE_NETWORK", "retryable");
}

async function applyApiError(
	supabase: SupabaseClient,
	apiJobs: PreparedYouTubeJob[],
	apiError: YouTubeApiError,
	now: () => Date,
	result: YouTubeWorkerResult
) {
	for (const { job } of apiJobs) {
		if (apiError.disposition === "retryable") {
			await retryJob(supabase, job, apiError.code, now, result);
		} else {
			await failJob(supabase, job, apiError.code, result);
		}
	}
}

async function applyVideoResults(
	supabase: SupabaseClient,
	apiJobs: PreparedYouTubeJob[],
	videos: Map<string, YouTubeVideoResult>,
	result: YouTubeWorkerResult
) {
	for (const prepared of apiJobs) {
		const video = videos.get(prepared.target.videoId as string);
		if (video) {
			await completeReadyJob(supabase, prepared, video, result);
		} else {
			await completeUnavailableJob(supabase, prepared, result);
		}
	}
}

export async function runYouTubeEnrichmentWorker(
	supabase: SupabaseClient,
	{
		apiKey,
		limit = YOUTUBE_MAX_BATCH_SIZE,
		fetchImpl = fetch,
		timeoutMs = 10_000,
		now = () => new Date(),
	}: {
		apiKey: string;
		limit?: number;
		fetchImpl?: typeof fetch;
		timeoutMs?: number;
		now?: () => Date;
	}
): Promise<YouTubeWorkerResult> {
	if (!apiKey.trim()) throw new YouTubeWorkerError("YOUTUBE_API_KEY_MISSING");
	if (!Number.isInteger(limit) || limit < 1 || limit > YOUTUBE_MAX_BATCH_SIZE) {
		throw new YouTubeWorkerError("YOUTUBE_INVALID_LIMIT");
	}

	const { data, error } = await supabase.rpc("claim_media_enrichment_jobs", {
		p_provider: "youtube",
		p_limit: limit,
		p_lease_seconds: YOUTUBE_LEASE_SECONDS,
	});
	if (error) throw new YouTubeWorkerError("YOUTUBE_CLAIM_FAILED");

	const jobs = validateClaimedJobs(data ?? []);
	const result = createEmptyResult();
	result.claimedCount = jobs.length;
	if (jobs.length === 0) return result;

	const apiJobs = await prepareApiJobs(supabase, jobs, result);
	if (apiJobs.length === 0) return result;

	let videos: Map<string, YouTubeVideoResult>;
	try {
		videos = await listYouTubeVideos(
			apiJobs.map(({ target }) => target.videoId as string),
			{ apiKey, fetchImpl, timeoutMs }
		);
	} catch (error) {
		await applyApiError(supabase, apiJobs, normalizeApiError(error), now, result);
		return result;
	}

	await applyVideoResults(supabase, apiJobs, videos, result);
	return result;
}
