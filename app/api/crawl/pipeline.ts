import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrawlItemType } from "@/lib/type-defs";
import type { CrawlExecutionResult, CrawlTarget } from "./contracts";
import { getErrorMessage } from "./contracts";
import { runCrawlerWithRetry } from "./crawl-runner";
import {
	type CrawlErrorStage,
	chunkUrlsForHistoryQuery,
	createRunResult,
	dedupeByUrl,
	defineType,
	type FilterKeyword,
	getCompletedRunStatus,
} from "./pipeline-helpers";

const CRAWL_LOCK_KEY = "global-crawl";
const CRAWL_LOCK_TTL_SECONDS = 300;

interface CrawlRunHandle {
	runId: string;
	lockToken: string;
}

interface PreparedCrawlItem extends CrawlItemType {
	type: string;
}

export interface ManualCrawlSuccess {
	runId: string;
	status: "succeeded" | "partial";
	target: CrawlTarget;
	insertedCount: number;
	skippedCount: number;
	warningCount: number;
	durationMs: number;
}

export class CrawlPipelineError extends Error {
	constructor(
		message: string,
		readonly httpStatus: number,
		readonly stage: CrawlErrorStage,
		readonly crawlData: CrawlExecutionResult | null = null,
		readonly runId?: string,
		readonly activeRunId?: string | null
	) {
		super(message);
		this.name = "CrawlPipelineError";
	}
}

type CrawlRunner = (target: CrawlTarget) => Promise<CrawlExecutionResult>;

async function beginCrawlRun(
	supabase: SupabaseClient,
	target: CrawlTarget
): Promise<CrawlRunHandle> {
	const lockToken = crypto.randomUUID();
	const { data, error } = await supabase.rpc("begin_crawl_run", {
		p_source: target,
		p_lock_token: lockToken,
		p_ttl_seconds: CRAWL_LOCK_TTL_SECONDS,
	});
	if (error) {
		throw new CrawlPipelineError(error.message, 500, "unknown");
	}

	const result = (data ?? {}) as {
		acquired?: boolean;
		runId?: string;
		activeRunId?: string | null;
	};
	if (!result.acquired) {
		throw new CrawlPipelineError(
			"다른 크롤링 작업이 이미 실행 중입니다.",
			409,
			"unknown",
			null,
			undefined,
			result.activeRunId ?? null
		);
	}
	if (typeof result.runId !== "string") {
		throw new CrawlPipelineError("Crawl run could not be created.", 500, "unknown");
	}

	return { runId: result.runId, lockToken };
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
	const ignoreList = filterList
		.filter((keyword) => keyword.method === "ignore")
		.map((keyword) => keyword.value);
	const filteredItems = dedupeByUrl(
		crawlData.items.filter(
			(item) => item.url && !ignoreList.some((keyword) => item.url.includes(keyword))
		)
	);
	const existingUrls = await getExistingUrls(
		supabase,
		target,
		filteredItems.map((item) => item.url)
	);
	const items: PreparedCrawlItem[] = filteredItems
		.filter((item) => !existingUrls.has(item.url))
		.map((item) => ({ ...item, type: defineType(item.url, filterList) }));
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

async function releaseCrawlLockFallback(supabase: SupabaseClient, lockToken: string) {
	const { error } = await supabase.rpc("release_crawl_lock", {
		p_lock_key: CRAWL_LOCK_KEY,
		p_lock_token: lockToken,
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
	return new CrawlPipelineError(getErrorMessage(error), 500, "source", crawlData);
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
	runCrawler: CrawlRunner = runCrawlerWithRetry
): Promise<ManualCrawlSuccess> {
	const handle = await beginCrawlRun(supabase, target);
	let crawlData: CrawlExecutionResult | null = null;
	let finalized = false;
	console.info("[crawl] run_started", { runId: handle.runId, target });

	try {
		try {
			crawlData = await runCrawler(target);
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
			warningCount: crawlData.failures.length + crawlData.warnings.length,
			durationMs,
		};
	} catch (error) {
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
		if (!finalized) {
			await releaseCrawlLockFallback(supabase, handle.lockToken);
		}
	}
}
