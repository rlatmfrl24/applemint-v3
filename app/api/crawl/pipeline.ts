import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrawlAdmissionReason, CrawlCommandSuccess } from "@/contracts/crawl-command.schema";
import type { CrawlItemType } from "@/lib/type-defs";
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
const DEFAULT_RUN_BUDGET_SECONDS = 45;
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 15;

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

interface CrawlPipelineOptions {
	trigger?: CrawlRunTrigger;
}

interface CrawlStartResult {
	acquired?: boolean;
	runId?: string;
	activeRunId?: string | null;
	reason?: CrawlAdmissionReason;
	nextEligibleAt?: string | null;
	retryAfterSeconds?: number;
	lockKey?: string;
	runBudgetSeconds?: number;
	heartbeatIntervalSeconds?: number;
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

function createAdmissionError(result: CrawlStartResult, trigger: CrawlRunTrigger) {
	const reason = result.reason ?? "source-busy";
	return new CrawlPipelineError(
		getAdmissionMessage(reason),
		trigger === "scheduled" && reason === "capacity" ? 429 : 409,
		"unknown",
		null,
		undefined,
		result.activeRunId ?? null,
		reason,
		result.nextEligibleAt ?? null,
		Number(result.retryAfterSeconds ?? 30)
	);
}

function createRunHandle(result: CrawlStartResult, lockToken: string, target: CrawlTarget) {
	if (typeof result.runId !== "string") {
		throw new CrawlPipelineError("Crawl run could not be created.", 500, "unknown");
	}
	return {
		runId: result.runId,
		lockToken,
		lockKey: result.lockKey ?? `crawl:${target}`,
		runBudgetSeconds: Number(result.runBudgetSeconds ?? DEFAULT_RUN_BUDGET_SECONDS),
		heartbeatIntervalSeconds: Number(
			result.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS
		),
	};
}

async function beginCrawlRun(
	supabase: SupabaseClient,
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

	const result = (data ?? {}) as CrawlStartResult;
	if (!result.acquired) {
		throw createAdmissionError(result, trigger);
	}
	return createRunHandle(result, lockToken, target);
}

function startLeaseHeartbeat(
	supabase: SupabaseClient,
	handle: CrawlRunHandle,
	abortController: AbortController
) {
	let consecutiveErrors = 0;
	let inFlight: Promise<void> | null = null;
	let leaseFailure: Error | null = null;
	const renew = async () => {
		const { data, error } = await supabase.rpc("heartbeat_crawl_run", {
			p_run_id: handle.runId,
			p_lock_token: handle.lockToken,
		});
		if (error) {
			consecutiveErrors += 1;
			console.error("[crawl] heartbeat_failed", {
				runId: handle.runId,
				consecutiveErrors,
				message: error.message,
			});
			if (consecutiveErrors >= 2) {
				leaseFailure = new Error("크롤링 잠금 heartbeat가 연속으로 실패했습니다.");
				leaseFailure.name = "CrawlLeaseError";
				abortController.abort(leaseFailure);
			}
			return;
		}

		consecutiveErrors = 0;
		const result = (data ?? {}) as { renewed?: boolean };
		if (!result.renewed) {
			leaseFailure = new Error("크롤링 잠금 소유권을 잃었습니다.");
			leaseFailure.name = "CrawlLeaseError";
			abortController.abort(leaseFailure);
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

async function loadFilterKeywords(supabase: SupabaseClient) {
	const { data, error } = await supabase.from("filter-keyword").select("value, method");
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "filter");
	}
	return (data ?? []) as FilterKeyword[];
}

async function getExistingUrls(supabase: SupabaseClient, target: CrawlTarget, urls: string[]) {
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
		for (const row of (data ?? []) as { url: string | null }[]) {
			if (typeof row.url === "string") {
				existingUrls.add(row.url);
			}
		}
	}
	return existingUrls;
}

async function prepareItems(
	supabase: SupabaseClient,
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
	supabase: SupabaseClient,
	target: CrawlTarget,
	items: PreparedCrawlItem[]
) {
	const { data, error } = await supabase.rpc("ingest_crawl_items", {
		p_crawl_source: target,
		p_items: items,
	});
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "ingest");
	}
	return (data ?? {}) as { insertedCount?: number; skippedCount?: number };
}

async function finishCrawlRun(
	supabase: SupabaseClient,
	handle: CrawlRunHandle,
	result: ReturnType<typeof createRunResult>
) {
	const { data, error } = await supabase.rpc("finish_crawl_run", {
		p_run_id: handle.runId,
		p_lock_token: handle.lockToken,
		p_result: result,
	});
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "unknown");
	}
	return (data ?? {}) as { durationMs?: number };
}

async function releaseCrawlLockFallback(supabase: SupabaseClient, handle: CrawlRunHandle) {
	const { error } = await supabase.rpc("release_crawl_lock", {
		p_lock_key: handle.lockKey,
		p_lock_token: handle.lockToken,
	});
	if (error) {
		console.error("[crawl] lock_release_failed", { message: error.message });
	}
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
	supabase: SupabaseClient,
	runCrawler: CrawlRunner = (crawlTarget, adapterOptions) =>
		runCrawlerWithRetry(crawlTarget, undefined, undefined, adapterOptions),
	options: CrawlPipelineOptions = {}
): Promise<CrawlCommandSuccess> {
	const trigger = options.trigger ?? "manual";
	const handle = await beginCrawlRun(supabase, target, trigger);
	const abortController = new AbortController();
	const budgetTimer = setTimeout(() => {
		abortController.abort(new DOMException("Crawl run budget exceeded.", "TimeoutError"));
	}, handle.runBudgetSeconds * 1000);
	const heartbeat = startLeaseHeartbeat(supabase, handle, abortController);
	let crawlData: CrawlExecutionResult | null = null;
	let finalized = false;
	let heartbeatStopped = false;
	const stopHeartbeat = async () => {
		if (heartbeatStopped) return;
		heartbeatStopped = true;
		await heartbeat.stop();
	};
	console.info("[crawl] run_started", { runId: handle.runId, target, trigger });

	try {
		try {
			crawlData = await runCrawler(target, { signal: abortController.signal });
			if (heartbeat.getFailure()) throw heartbeat.getFailure();
			assertSuccessfulSourceResult(crawlData);
		} catch (error) {
			throw normalizePipelineError(error, crawlData);
		}

		const filterList = await loadFilterKeywords(supabase);
		const prepared = await prepareItems(supabase, target, crawlData, filterList);
		const counts = await ingestItems(supabase, target, prepared.items);
		const insertedCount = Number(counts.insertedCount ?? 0);
		const skippedCount = prepared.existingCount + Number(counts.skippedCount ?? 0);
		const status = getCompletedRunStatus(crawlData);
		await stopHeartbeat();
		const completion = await finishCrawlRun(
			supabase,
			handle,
			createRunResult(status, crawlData, insertedCount, skippedCount)
		);
		finalized = true;
		const durationMs = Number(completion.durationMs ?? 0);
		console.info("[crawl] run_completed", {
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
					pipelineError.message
				)
			);
			finalized = true;
		} catch (finishError) {
			console.error("[crawl] run_finalization_failed", {
				runId: handle.runId,
				target,
				message: getErrorMessage(finishError),
			});
		}

		console.error("[crawl] run_failed", {
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
