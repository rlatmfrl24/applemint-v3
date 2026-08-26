import type { CrawlAdmissionReason, CrawlCommandSuccess } from "@/contracts/crawl-command.schema";
import {
	type CrawlStartRawResponse,
	crawlContractFailureRawResponseSchema,
	crawlFinishRawResponseSchema,
	crawlHeartbeatRawResponseSchema,
	crawlHistoryRowsRawResponseSchema,
	crawlIngestRawResponseSchema,
	crawlStartRawResponseSchema,
} from "@/contracts/crawl-pipeline.schema";
import type { CrawlItemType } from "@/lib/type-defs";
import type { Json } from "@/types/database.types";
import type { AppSupabaseClient } from "@/types/supabase";
import {
	type CrawlAdapterOptions,
	type CrawlExecutionResult,
	type CrawlTarget,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { runCrawlerWithRetry } from "./crawl-runner";
import {
	type CrawlErrorStage,
	chunkUrlsForHistoryQuery,
	countCrawlWarnings,
	createRunResult,
	dedupeByUrl,
	type FilterKeyword,
	getCompletedRunStatus,
	matchFilteredUrl,
} from "./pipeline-helpers";

const CRAWL_LOCK_TTL_SECONDS = 60;
type CrawlRunTrigger = "manual" | "scheduled";

interface CrawlRunHandle {
	runId: string;
	lockToken: string;
	lockKey: string;
	runBudgetSeconds: number;
	heartbeatIntervalSeconds: number;
}

interface PreparedCrawlItem extends CrawlItemType {
	type: string;
}

export class CrawlPipelineError extends Error {
	constructor(
		message: string,
		readonly httpStatus: number,
		readonly stage: CrawlErrorStage,
		readonly crawlData: CrawlExecutionResult | null = null,
		readonly runId?: string,
		readonly activeRunId?: string | null,
		readonly admissionReason?: CrawlAdmissionReason,
		readonly nextEligibleAt?: string | null,
		readonly retryAfterSeconds?: number
	) {
		super(message);
		this.name = "CrawlPipelineError";
	}
}

type CrawlRunner = (
	target: CrawlTarget,
	options?: CrawlAdapterOptions
) => Promise<CrawlExecutionResult>;

export interface CrawlPipelineOptions {
	trigger?: CrawlRunTrigger;
	requestId?: string;
}

function getAdmissionMessage(reason: CrawlAdmissionReason) {
	const messages: Record<CrawlAdmissionReason, string> = {
		capacity: "허용된 최대 크롤링 동시성에 도달했습니다.",
		cooldown: "아직 소스별 수집 대기 시간이 지나지 않았습니다.",
		disabled: "예약 크롤링이 비활성화된 소스입니다.",
		"source-busy": "같은 소스의 크롤링 작업이 이미 실행 중입니다.",
	};
	return messages[reason];
}

function createAdmissionError(
	result: Exclude<CrawlStartRawResponse, { acquired: true }>,
	trigger: CrawlRunTrigger
) {
	const reason = result.reason;
	return new CrawlPipelineError(
		getAdmissionMessage(reason),
		trigger === "scheduled" && reason === "capacity" ? 429 : 409,
		"unknown",
		null,
		undefined,
		"activeRunId" in result ? (result.activeRunId ?? null) : null,
		reason,
		"nextEligibleAt" in result ? result.nextEligibleAt : null,
		"retryAfterSeconds" in result ? result.retryAfterSeconds : undefined
	);
}

function createRunHandle(
	result: Extract<CrawlStartRawResponse, { acquired: true }>,
	lockToken: string
) {
	return {
		runId: result.runId,
		lockToken,
		lockKey: result.lockKey,
		runBudgetSeconds: result.runBudgetSeconds,
		heartbeatIntervalSeconds: result.heartbeatIntervalSeconds,
	};
}

function invalidRpcResponse(name: string, stage: CrawlErrorStage) {
	return new CrawlPipelineError(`${name} 응답 계약이 올바르지 않습니다.`, 500, stage);
}

function getSafeRunErrorMessage(stage: CrawlErrorStage) {
	const messages: Record<CrawlErrorStage, string> = {
		source: "수집 소스 처리에 실패했습니다.",
		filter: "수집 필터 처리에 실패했습니다.",
		history: "수집 이력 확인에 실패했습니다.",
		ingest: "수집 항목 저장에 실패했습니다.",
		unknown: "크롤링 실행 계약 처리에 실패했습니다.",
	};
	return messages[stage];
}

async function beginCrawlRun(
	supabase: AppSupabaseClient,
	target: CrawlTarget,
	trigger: CrawlRunTrigger
): Promise<CrawlRunHandle> {
	const lockToken = crypto.randomUUID();
	const rpcName = trigger === "scheduled" ? "begin_scheduled_crawl_run" : "begin_crawl_run";
	const { data, error } = await supabase.rpc(rpcName, {
		p_source: target,
		p_lock_token: lockToken,
		p_ttl_seconds: CRAWL_LOCK_TTL_SECONDS,
	});
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "unknown");
	}

	const parsed = crawlStartRawResponseSchema.safeParse(data);
	if (!parsed.success) {
		throw invalidRpcResponse(rpcName, "unknown");
	}
	const result = parsed.data;
	if (!result.acquired) {
		throw createAdmissionError(result, trigger);
	}
	return createRunHandle(result, lockToken);
}

function startLeaseHeartbeat(
	supabase: AppSupabaseClient,
	handle: CrawlRunHandle,
	abortController: AbortController,
	requestId?: string
) {
	let consecutiveErrors = 0;
	let inFlight: Promise<void> | null = null;
	let leaseFailure: Error | null = null;
	const failLease = (error: Error) => {
		leaseFailure = error;
		abortController.abort(error);
	};
	const renew = async () => {
		const { data, error } = await supabase.rpc("heartbeat_crawl_run", {
			p_run_id: handle.runId,
			p_lock_token: handle.lockToken,
		} as never);
		if (error) {
			consecutiveErrors += 1;
			console.error("[crawl] heartbeat_failed", {
				requestId,
				runId: handle.runId,
				consecutiveErrors,
				message: error.message,
			});
			if (consecutiveErrors >= 2) {
				const error = new Error("크롤링 잠금 heartbeat가 연속으로 실패했습니다.");
				error.name = "CrawlLeaseError";
				failLease(error);
			}
			return;
		}

		consecutiveErrors = 0;
		const parsed = crawlHeartbeatRawResponseSchema.safeParse(data);
		if (!parsed.success) {
			failLease(invalidRpcResponse("heartbeat_crawl_run", "unknown"));
			return;
		}
		const result = parsed.data;
		if (!result.renewed) {
			const error = new Error("크롤링 잠금 소유권을 잃었습니다.");
			error.name = "CrawlLeaseError";
			failLease(error);
		}
	};
	const timer = setInterval(() => {
		if (inFlight || abortController.signal.aborted) return;
		inFlight = renew().finally(() => {
			inFlight = null;
		});
	}, handle.heartbeatIntervalSeconds * 1000);

	return {
		getFailure: () => leaseFailure,
		stop: async () => {
			clearInterval(timer);
			if (inFlight) await inFlight;
		},
	};
}

async function loadFilterKeywords(supabase: AppSupabaseClient) {
	const { data, error } = await supabase.from("filter-keyword").select("value, method");
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "filter");
	}
	return (data ?? []) as FilterKeyword[];
}

async function getExistingUrls(supabase: AppSupabaseClient, target: CrawlTarget, urls: string[]) {
	const existingUrls = new Set<string>();
	for (const chunk of chunkUrlsForHistoryQuery(urls)) {
		const { data, error } = await supabase
			.from("crawl-history")
			.select("url")
			.eq("crawl_source", target)
			.in("url", chunk);
		if (error) {
			throw new CrawlPipelineError(error.message, 500, "history");
		}
		const parsed = crawlHistoryRowsRawResponseSchema.safeParse(data);
		if (!parsed.success) {
			throw invalidRpcResponse("crawl-history", "history");
		}
		for (const row of parsed.data) {
			existingUrls.add(row.url);
		}
	}
	return existingUrls;
}

async function prepareItems(
	supabase: AppSupabaseClient,
	target: CrawlTarget,
	crawlData: CrawlExecutionResult,
	filterList: FilterKeyword[]
) {
	const filteredItems: PreparedCrawlItem[] = [];
	for (const item of dedupeByUrl(crawlData.items)) {
		const match = matchFilteredUrl(item.url, filterList);
		if (!match.ignored) filteredItems.push({ ...item, type: match.type });
	}
	const existingUrls = await getExistingUrls(
		supabase,
		target,
		filteredItems.map((item) => item.url)
	);
	const items = filteredItems.filter((item) => !existingUrls.has(item.url));
	return { items, existingCount: existingUrls.size };
}

async function ingestItems(
	supabase: AppSupabaseClient,
	target: CrawlTarget,
	items: PreparedCrawlItem[]
) {
	const { data, error } = await supabase.rpc("ingest_crawl_items", {
		p_crawl_source: target,
		p_items: items as unknown as Json,
	});
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "ingest");
	}
	const parsed = crawlIngestRawResponseSchema.safeParse(data);
	if (!parsed.success) {
		throw invalidRpcResponse("ingest_crawl_items", "ingest");
	}
	return parsed.data;
}

async function finishCrawlRun(
	supabase: AppSupabaseClient,
	handle: CrawlRunHandle,
	result: ReturnType<typeof createRunResult>
) {
	const { data, error } = await supabase.rpc("finish_crawl_run", {
		p_run_id: handle.runId,
		p_lock_token: handle.lockToken,
		p_result: result as unknown as Json,
	} as never);
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "unknown");
	}
	const parsed = crawlFinishRawResponseSchema.safeParse(data);
	if (!parsed.success) {
		throw invalidRpcResponse("finish_crawl_run", "unknown");
	}
	return parsed.data;
}

async function releaseCrawlLockFallback(supabase: AppSupabaseClient, handle: CrawlRunHandle) {
	const { error } = await supabase.rpc("release_crawl_lock", {
		p_lock_key: handle.lockKey,
		p_lock_token: handle.lockToken,
	});
	if (error) {
		console.error("[crawl] lock_release_failed", { message: error.message });
	}
}

async function recordCrawlContractFailure(
	supabase: AppSupabaseClient,
	handle: CrawlRunHandle,
	stage: CrawlErrorStage,
	message: string
) {
	const { data, error } = await supabase.rpc("record_crawl_run_contract_failure", {
		p_run_id: handle.runId,
		p_lock_token: handle.lockToken,
		p_error_stage: stage,
		p_error_message: message,
	} as never);
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "unknown");
	}
	const parsed = crawlContractFailureRawResponseSchema.safeParse(data);
	if (!parsed.success) {
		throw invalidRpcResponse("record_crawl_run_contract_failure", "unknown");
	}
	return parsed.data;
}

function normalizePipelineError(error: unknown, crawlData: CrawlExecutionResult | null) {
	if (error instanceof CrawlPipelineError) {
		return new CrawlPipelineError(
			error.message,
			error.httpStatus,
			error.stage,
			error.crawlData ?? crawlData
		);
	}
	return new CrawlPipelineError(
		getErrorMessage(error),
		isTimeoutError(error) ? 504 : 500,
		"source",
		crawlData
	);
}

function assertSuccessfulSourceResult(crawlData: CrawlExecutionResult) {
	if (crawlData.succeeded > 0) {
		return;
	}
	const allFailuresTimedOut =
		crawlData.failures.length > 0 &&
		crawlData.failures.every((failure) => failure.timeout === true);
	throw new CrawlPipelineError(
		"모든 소스 요청이 실패했습니다.",
		allFailuresTimedOut ? 504 : 502,
		"source",
		crawlData
	);
}

export async function executeCrawlPipeline(
	target: CrawlTarget,
	supabase: AppSupabaseClient,
	runCrawler: CrawlRunner = (crawlTarget, adapterOptions) =>
		runCrawlerWithRetry(crawlTarget, undefined, undefined, adapterOptions),
	options: CrawlPipelineOptions = {}
): Promise<CrawlCommandSuccess> {
	const trigger = options.trigger ?? "manual";
	const requestId = options.requestId;
	const handle = await beginCrawlRun(supabase, target, trigger);
	const abortController = new AbortController();
	const budgetTimer = setTimeout(() => {
		abortController.abort(new DOMException("Crawl run budget exceeded.", "TimeoutError"));
	}, handle.runBudgetSeconds * 1000);
	const heartbeat = startLeaseHeartbeat(supabase, handle, abortController, requestId);
	let crawlData: CrawlExecutionResult | null = null;
	let finalized = false;
	let heartbeatStopped = false;
	const stopHeartbeat = async () => {
		if (heartbeatStopped) return;
		heartbeatStopped = true;
		await heartbeat.stop();
	};
	console.info("[crawl] run_started", { requestId, runId: handle.runId, target, trigger });

	try {
		try {
			crawlData = await runCrawler(target, {
				signal: abortController.signal,
				requestId,
				runId: handle.runId,
			});
			if (heartbeat.getFailure()) throw heartbeat.getFailure();
			assertSuccessfulSourceResult(crawlData);
		} catch (error) {
			throw normalizePipelineError(error, crawlData);
		}

		const filterList = await loadFilterKeywords(supabase);
		const prepared = await prepareItems(supabase, target, crawlData, filterList);
		const counts = await ingestItems(supabase, target, prepared.items);
		const insertedCount = counts.insertedCount;
		const skippedCount = prepared.existingCount + counts.skippedCount;
		const status = getCompletedRunStatus(crawlData);
		await stopHeartbeat();
		const completion = await finishCrawlRun(
			supabase,
			handle,
			createRunResult(status, crawlData, insertedCount, skippedCount)
		);
		finalized = true;
		const durationMs = completion.durationMs;
		console.info("[crawl] run_completed", {
			requestId,
			runId: handle.runId,
			target,
			status,
			insertedCount,
			skippedCount,
			durationMs,
		});

		return {
			runId: handle.runId,
			status,
			target,
			insertedCount,
			skippedCount,
			warningCount: countCrawlWarnings(crawlData.failures, crawlData.warnings),
			durationMs,
		};
	} catch (error) {
		await stopHeartbeat();
		const pipelineError = normalizePipelineError(error, crawlData);
		const safeErrorMessage = getSafeRunErrorMessage(pipelineError.stage);
		try {
			await finishCrawlRun(
				supabase,
				handle,
				createRunResult(
					"failed",
					pipelineError.crawlData,
					0,
					0,
					pipelineError.stage,
					safeErrorMessage
				)
			);
			finalized = true;
		} catch (finishError) {
			console.error("[crawl] run_finalization_failed", {
				requestId,
				runId: handle.runId,
				target,
				message: getErrorMessage(finishError),
			});
			try {
				finalized = await recordCrawlContractFailure(
					supabase,
					handle,
					pipelineError.stage,
					safeErrorMessage
				);
			} catch (recordError) {
				console.error("[crawl] contract_failure_record_failed", {
					requestId,
					runId: handle.runId,
					target,
					message: getErrorMessage(recordError),
				});
			}
		}

		console.error("[crawl] run_failed", {
			requestId,
			runId: handle.runId,
			target,
			stage: pipelineError.stage,
			message: pipelineError.message,
		});
		throw new CrawlPipelineError(
			pipelineError.message,
			pipelineError.httpStatus,
			pipelineError.stage,
			pipelineError.crawlData,
			handle.runId
		);
	} finally {
		clearTimeout(budgetTimer);
		await stopHeartbeat();
		if (!finalized) {
			await releaseCrawlLockFallback(supabase, handle);
		}
	}
}
