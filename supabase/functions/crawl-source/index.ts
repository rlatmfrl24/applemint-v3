/// <reference lib="deno.ns" />

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
	type CrawlTarget,
	calculateParserTrend,
	chunkUrlsForHistoryQuery,
	constantTimeEquals,
	countCrawlFailureKinds,
	countCrawlWarnings,
	dedupeByUrl,
	defineType,
	type FilterKeyword,
	getCompletedRunStatus,
	hasMinimumInternalSecretLength,
	isCrawlTarget,
	normalizeCrawlApiBaseUrl,
} from "./helpers.ts";

const CRAWL_LOCK_KEY = "global-crawl";
const CRAWL_LOCK_TTL_SECONDS = 300;
const CRAWL_API_TIMEOUT_MS = 90_000;
const CRAWL_API_BASE_URL = normalizeCrawlApiBaseUrl(Deno.env.get("CRAWL_API_BASE_URL"));

interface CrawlItem {
	url: string;
	title: string | null;
	description: string | null;
	host: string | null;
	tag?: string[] | null;
}

interface CrawlFailure {
	url: string;
	message: string;
	kind: "network" | "parser";
	timeout?: boolean;
	attempt?: number;
}

interface CrawlWarning {
	url: string;
	code: "empty-list" | "below-minimum-items" | "discarded-items";
	message: string;
	count: number;
	attempt?: number;
}

interface ParserObservation {
	url: string;
	status: "ok" | "empty" | "failure";
	candidateCount: number;
	validCount: number;
	discardedCount: number;
	minimumItems: number;
	attempt?: number;
}

interface CrawlApiResponse {
	target: CrawlTarget;
	items: CrawlItem[];
	attempted: number;
	succeeded: number;
	failures: CrawlFailure[];
	warnings: CrawlWarning[];
	parserObservations: ParserObservation[];
	retryCount: number;
	parserValidCount: number;
	parserMinimumCount: number;
	durationMs: number;
}

interface PreparedCrawlItem extends CrawlItem {
	type: string;
}

interface CrawlRequestContext {
	target: CrawlTarget;
	internalSecret: string;
	supabase: SupabaseClient;
}

type CrawlErrorStage = "source" | "filter" | "history" | "ingest" | "unknown";

interface CrawlRunHandle {
	runId: string;
	lockToken: string;
}

interface ProcessedCrawl {
	crawlData: CrawlApiResponse;
	insertedCount: number;
	skippedCount: number;
}

class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly stage: CrawlErrorStage = "source",
		readonly crawlData: CrawlApiResponse | null = null
	) {
		super(message);
	}
}

class PipelineError extends Error {
	constructor(
		message: string,
		readonly stage: CrawlErrorStage,
		readonly crawlData: CrawlApiResponse | null
	) {
		super(message);
	}
}

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "Unknown error";

function normalizeCrawlData(
	target: CrawlTarget,
	responseBody: Record<string, unknown> | null
): CrawlApiResponse | null {
	if (!responseBody) return null;
	return {
		target,
		items: Array.isArray(responseBody.items) ? responseBody.items : [],
		attempted: Number(responseBody.attempted ?? 0),
		succeeded: Number(responseBody.succeeded ?? 0),
		failures: Array.isArray(responseBody.failures) ? responseBody.failures : [],
		warnings: Array.isArray(responseBody.warnings) ? responseBody.warnings : [],
		parserObservations: Array.isArray(responseBody.parserObservations)
			? responseBody.parserObservations
			: [],
		retryCount: Number(responseBody.retryCount ?? 0),
		parserValidCount: Number(responseBody.parserValidCount ?? 0),
		parserMinimumCount: Number(responseBody.parserMinimumCount ?? 0),
		durationMs: Number(responseBody.durationMs ?? 0),
	} as CrawlApiResponse;
}

function createTransportFailureData(
	target: CrawlTarget,
	url: string,
	message: string,
	timeout: boolean
): CrawlApiResponse {
	return {
		target,
		items: [],
		attempted: 0,
		succeeded: 0,
		failures: [{ url, message, kind: "network", timeout, attempt: 1 }],
		warnings: [],
		parserObservations: [],
		retryCount: 0,
		parserValidCount: 0,
		parserMinimumCount: 0,
		durationMs: 0,
	};
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
			throw error;
		}

		for (const row of (data ?? []) as { url: string | null }[]) {
			if (typeof row.url === "string") {
				existingUrls.add(row.url);
			}
		}
	}

	return existingUrls;
}

async function createRequestContext(request: Request): Promise<CrawlRequestContext | Response> {
	if (request.method !== "POST") {
		return jsonResponse({ error: "Method not allowed" }, 405);
	}

	const internalSecret = Deno.env.get("CRAWL_INTERNAL_SECRET");
	if (!hasMinimumInternalSecretLength(internalSecret)) {
		return jsonResponse({ error: "Internal crawl authentication is not configured" }, 503);
	}

	if (
		!(await constantTimeEquals(request.headers.get("x-applemint-internal-secret"), internalSecret))
	) {
		return jsonResponse({ error: "Unauthorized internal request" }, 401);
	}

	const body = (await request.json().catch(() => null)) as { target?: unknown } | null;
	if (!isCrawlTarget(body?.target)) {
		return jsonResponse({ error: "Unsupported crawl target" }, 400);
	}

	const supabaseUrl = Deno.env.get("SUPABASE_URL");
	const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
	if (!supabaseUrl || !supabaseAnonKey) {
		return jsonResponse({ error: "Supabase client configuration is missing" }, 503);
	}

	return {
		target: body.target,
		internalSecret,
		supabase: createClient(supabaseUrl, supabaseAnonKey, {
			global: {
				headers: {
					Authorization: request.headers.get("Authorization") ?? "",
				},
			},
		}),
	};
}

async function fetchCrawlData(target: CrawlTarget, internalSecret: string) {
	if (!CRAWL_API_BASE_URL) {
		throw new HttpError("CRAWL_API_BASE_URL is not configured", 503);
	}

	const crawlUrl = `${CRAWL_API_BASE_URL}/api/crawl`;
	let crawlResponse: Response;
	try {
		crawlResponse = await fetch(crawlUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-applemint-internal-secret": internalSecret,
			},
			body: JSON.stringify({ target }),
			signal: AbortSignal.timeout(CRAWL_API_TIMEOUT_MS),
		});
	} catch (error) {
		const timeout =
			error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
		const message = getErrorMessage(error);
		throw new HttpError(
			message,
			timeout ? 504 : 502,
			"source",
			createTransportFailureData(target, crawlUrl, message, timeout)
		);
	}
	const responseBody = (await crawlResponse.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const crawlData = normalizeCrawlData(target, responseBody);
	if (!crawlResponse.ok || !crawlData || !Array.isArray(responseBody?.items)) {
		const passthroughStatuses = new Set([400, 401, 403, 409, 503, 504]);
		const responseError =
			typeof responseBody?.error === "string"
				? responseBody.error
				: "크롤링 소스 요청에 실패했습니다.";
		const failureData =
			crawlData && crawlData.failures.length > 0
				? crawlData
				: createTransportFailureData(target, crawlUrl, responseError, crawlResponse.status === 504);
		throw new HttpError(
			responseError,
			passthroughStatuses.has(crawlResponse.status) ? crawlResponse.status : 502,
			"source",
			failureData
		);
	}

	return crawlData;
}

async function loadFilterKeywords(supabase: SupabaseClient) {
	const { data, error } = await supabase.from("filter-keyword").select("value, method");
	if (error) {
		throw error;
	}

	return (data ?? []) as FilterKeyword[];
}

async function prepareItems(
	supabase: SupabaseClient,
	target: CrawlTarget,
	crawlData: CrawlApiResponse,
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
	const newItems = filteredItems.filter((item) => !existingUrls.has(item.url));
	const items: PreparedCrawlItem[] = newItems.map((item) => ({
		...item,
		type: defineType(item.url, filterList),
	}));

	return { items, existingCount: existingUrls.size };
}

async function processCrawl(context: CrawlRequestContext): Promise<ProcessedCrawl> {
	const crawlData = await fetchCrawlData(context.target, context.internalSecret);
	let filterList: FilterKeyword[];
	try {
		filterList = await loadFilterKeywords(context.supabase);
	} catch (error) {
		throw new PipelineError(getErrorMessage(error), "filter", crawlData);
	}

	let prepared: Awaited<ReturnType<typeof prepareItems>>;
	try {
		prepared = await prepareItems(context.supabase, context.target, crawlData, filterList);
	} catch (error) {
		throw new PipelineError(getErrorMessage(error), "history", crawlData);
	}

	const { data, error } = await context.supabase.rpc("ingest_crawl_items", {
		p_crawl_source: context.target,
		p_items: prepared.items,
	});
	if (error) {
		throw new PipelineError(error.message, "ingest", crawlData);
	}

	const counts = (data ?? {}) as { insertedCount?: number; skippedCount?: number };
	return {
		crawlData,
		insertedCount: Number(counts.insertedCount ?? 0),
		skippedCount: prepared.existingCount + Number(counts.skippedCount ?? 0),
	};
}

async function beginCrawlRun(
	supabase: SupabaseClient,
	target: CrawlTarget
): Promise<CrawlRunHandle | Response> {
	const lockToken = crypto.randomUUID();
	const { data, error } = await supabase.rpc("begin_crawl_run", {
		p_source: target,
		p_lock_token: lockToken,
		p_ttl_seconds: CRAWL_LOCK_TTL_SECONDS,
	});
	if (error) {
		throw error;
	}

	const result = (data ?? {}) as {
		acquired?: boolean;
		runId?: string;
		activeRunId?: string | null;
	};
	if (!result.acquired) {
		return jsonResponse(
			{
				error: "다른 크롤링 작업이 이미 실행 중입니다.",
				activeRunId: result.activeRunId ?? null,
			},
			409
		);
	}
	if (typeof result.runId !== "string") {
		throw new Error("Crawl run could not be created.");
	}

	return { runId: result.runId, lockToken };
}

function getCrawlDataFromError(error: unknown) {
	if (error instanceof HttpError || error instanceof PipelineError) {
		return error.crawlData;
	}
	return null;
}

function getErrorStage(error: unknown): CrawlErrorStage {
	if (error instanceof HttpError || error instanceof PipelineError) {
		return error.stage;
	}
	return "unknown";
}

function createRunResult(
	status: "succeeded" | "partial" | "failed",
	crawlData: CrawlApiResponse | null,
	insertedCount: number,
	skippedCount: number,
	errorStage?: CrawlErrorStage,
	errorMessage?: string
) {
	const failures = Array.isArray(crawlData?.failures) ? crawlData.failures : [];
	const warnings = Array.isArray(crawlData?.warnings) ? crawlData.warnings : [];
	const parserObservations = Array.isArray(crawlData?.parserObservations)
		? crawlData.parserObservations
		: [];
	const retryCount = Math.max(0, Number(crawlData?.retryCount ?? 0));
	const failureCounts = countCrawlFailureKinds(failures);
	const parserTrend = calculateParserTrend(parserObservations, retryCount);

	return {
		status,
		retryCount,
		attemptedCount: Math.max(0, Number(crawlData?.attempted ?? 0)),
		succeededCount: Math.max(0, Number(crawlData?.succeeded ?? 0)),
		extractedCount: Array.isArray(crawlData?.items) ? crawlData.items.length : 0,
		insertedCount: Math.max(0, insertedCount),
		skippedCount: Math.max(0, skippedCount),
		warningCount: warnings.length,
		failureCount: failures.length,
		...failureCounts,
		...parserTrend,
		warnings,
		failures,
		parserObservations,
		errorStage: errorStage ?? null,
		errorMessage: errorMessage ?? null,
	};
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
		throw error;
	}
	return (data ?? {}) as { runId?: string; status?: string; durationMs?: number };
}

async function releaseCrawlLockFallback(supabase: SupabaseClient, lockToken: string) {
	const { error } = await supabase.rpc("release_crawl_lock", {
		p_lock_key: CRAWL_LOCK_KEY,
		p_lock_token: lockToken,
	});
	if (error) {
		console.error(`[crawl-source] lock release fallback failed: ${error.message}`);
	}
}

function getErrorStatus(error: unknown) {
	if (error instanceof HttpError) {
		return error.status;
	}
	if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
		return 504;
	}
	return 500;
}

async function handleRequest(request: Request) {
	try {
		const context = await createRequestContext(request);
		if (context instanceof Response) {
			return context;
		}

		const run = await beginCrawlRun(context.supabase, context.target);
		if (run instanceof Response) {
			return run;
		}

		let finalized = false;
		try {
			const processed = await processCrawl(context);
			const status = getCompletedRunStatus(
				processed.crawlData.failures,
				processed.crawlData.warnings
			);
			const completion = await finishCrawlRun(
				context.supabase,
				run,
				createRunResult(
					status,
					processed.crawlData,
					processed.insertedCount,
					processed.skippedCount
				)
			);
			finalized = true;

			return jsonResponse({
				runId: run.runId,
				status,
				target: context.target,
				insertedCount: processed.insertedCount,
				skippedCount: processed.skippedCount,
				warningCount: countCrawlWarnings(
					processed.crawlData.failures,
					processed.crawlData.warnings
				),
				durationMs: Number(completion.durationMs ?? 0),
			});
		} catch (error) {
			const status = getErrorStatus(error);
			const crawlData = getCrawlDataFromError(error);
			try {
				await finishCrawlRun(
					context.supabase,
					run,
					createRunResult("failed", crawlData, 0, 0, getErrorStage(error), getErrorMessage(error))
				);
				finalized = true;
			} catch (finishError) {
				console.error(
					`[crawl-source] crawl run finalization failed: ${getErrorMessage(finishError)}`
				);
			}

			console.error(`[crawl-source] request failed: ${getErrorMessage(error)}`);
			return jsonResponse(
				{
					runId: run.runId,
					status: "failed",
					error:
						status === 504 ? "크롤링 요청 시간이 초과되었습니다." : "크롤링 처리에 실패했습니다.",
				},
				status
			);
		} finally {
			if (!finalized) {
				await releaseCrawlLockFallback(context.supabase, run.lockToken);
			}
		}
	} catch (error) {
		const status = getErrorStatus(error);
		console.error(`[crawl-source] request failed: ${getErrorMessage(error)}`);
		return jsonResponse(
			{
				error:
					status === 504 ? "크롤링 요청 시간이 초과되었습니다." : "크롤링 처리에 실패했습니다.",
			},
			status
		);
	}
}

Deno.serve(handleRequest);
