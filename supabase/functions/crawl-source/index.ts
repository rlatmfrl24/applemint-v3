/// <reference lib="deno.ns" />

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
	type CrawlTarget,
	chunkUrlsForHistoryQuery,
	constantTimeEquals,
	countActionableCrawlWarnings,
	countCrawlFailureKinds,
	countCrawlWarnings,
	createTransportFailureData,
	dedupeByUrl,
	defineType,
	type FilterKeyword,
	getCompletedRunStatus,
	hasMinimumInternalSecretLength,
	isCrawlTarget,
	normalizeCrawlApiBaseUrl,
} from "./helpers.ts";

const CRAWL_LOCK_TTL_SECONDS = 60;
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
	code: "empty-list" | "below-minimum-items" | "discarded-items" | "high-discard-rate";
	severity?: "info" | "warning";
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
	ignoredCount?: number;
	duplicateCount?: number;
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
	recoveredCount: number;
	parserValidCount: number;
	parserMinimumCount: number;
	durationMs: number;
}

interface PreparedCrawlItem extends CrawlItem {
	type: string;
}

interface CrawlRequestContext {
	target: CrawlTarget;
	trigger: "manual" | "scheduled";
	internalSecret: string;
	supabase: SupabaseClient;
}

type CrawlErrorStage = "source" | "filter" | "history" | "ingest" | "unknown";

interface CrawlRunHandle {
	runId: string;
	lockToken: string;
	lockKey: string;
	runBudgetSeconds: number;
	heartbeatIntervalSeconds: number;
}

interface CrawlStartResult {
	acquired?: boolean;
	runId?: string;
	activeRunId?: string | null;
	reason?: "disabled" | "cooldown" | "source-busy" | "capacity";
	nextEligibleAt?: string | null;
	retryAfterSeconds?: number;
	lockKey?: string;
	runBudgetSeconds?: number;
	heartbeatIntervalSeconds?: number;
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

const jsonResponse = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
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
		recoveredCount: Number(responseBody.recoveredCount ?? 0),
		parserValidCount: Number(responseBody.parserValidCount ?? 0),
		parserMinimumCount: Number(responseBody.parserMinimumCount ?? 0),
		durationMs: Number(responseBody.durationMs ?? 0),
	} as CrawlApiResponse;
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

	const body = (await request.json().catch(() => null)) as {
		target?: unknown;
		trigger?: unknown;
	} | null;
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
		trigger: body.trigger === "scheduled" ? "scheduled" : "manual",
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

async function fetchCrawlData(
	target: CrawlTarget,
	internalSecret: string,
	runBudgetSeconds: number,
	signal: AbortSignal
) {
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
			body: JSON.stringify({ target, budgetMs: runBudgetSeconds * 1000 }),
			signal,
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

async function processCrawl(
	context: CrawlRequestContext,
	handle: CrawlRunHandle,
	signal: AbortSignal
): Promise<ProcessedCrawl> {
	const crawlData = await fetchCrawlData(
		context.target,
		context.internalSecret,
		handle.runBudgetSeconds,
		signal
	);
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

const SCHEDULED_SKIP_REASONS = new Set(["disabled", "cooldown", "source-busy"]);

function createAdmissionResponse(
	result: CrawlStartResult,
	target: CrawlTarget,
	trigger: "manual" | "scheduled"
) {
	if (result.acquired) return null;
	const reason = result.reason ?? "source-busy";
	if (trigger === "scheduled" && SCHEDULED_SKIP_REASONS.has(reason)) {
		return jsonResponse({
			status: "skipped",
			target,
			reason,
			nextEligibleAt: result.nextEligibleAt ?? null,
			activeRunId: result.activeRunId ?? null,
		});
	}
	if (trigger === "scheduled" && reason === "capacity") {
		const retryAfterSeconds = Number(result.retryAfterSeconds ?? 30);
		return jsonResponse({ status: "deferred", target, reason, retryAfterSeconds }, 429, {
			"Retry-After": String(retryAfterSeconds),
		});
	}
	return jsonResponse(
		{
			error:
				reason === "capacity"
					? "허용된 최대 크롤링 동시성에 도달했습니다."
					: "같은 소스의 크롤링 작업이 이미 실행 중입니다.",
			activeRunId: result.activeRunId ?? null,
		},
		409
	);
}

function createRunHandle(result: CrawlStartResult, target: CrawlTarget, lockToken: string) {
	if (typeof result.runId !== "string") {
		throw new Error("Crawl run could not be created.");
	}
	return {
		runId: result.runId,
		lockToken,
		lockKey: result.lockKey ?? `crawl:${target}`,
		runBudgetSeconds: Number(result.runBudgetSeconds ?? 45),
		heartbeatIntervalSeconds: Number(result.heartbeatIntervalSeconds ?? 15),
	};
}

async function beginCrawlRun(
	supabase: SupabaseClient,
	target: CrawlTarget,
	trigger: "manual" | "scheduled"
): Promise<CrawlRunHandle | Response> {
	const lockToken = crypto.randomUUID();
	const rpcName = trigger === "scheduled" ? "begin_scheduled_crawl_run" : "begin_crawl_run";
	const { data, error } = await supabase.rpc(rpcName, {
		p_source: target,
		p_lock_token: lockToken,
		p_ttl_seconds: CRAWL_LOCK_TTL_SECONDS,
	});
	if (error) {
		throw error;
	}

	const result = (data ?? {}) as CrawlStartResult;
	const admissionResponse = createAdmissionResponse(result, target, trigger);
	if (admissionResponse) return admissionResponse;
	return createRunHandle(result, target, lockToken);
}

function startLeaseHeartbeat(
	supabase: SupabaseClient,
	handle: CrawlRunHandle,
	abortController: AbortController
) {
	let consecutiveErrors = 0;
	let inFlight: Promise<void> | null = null;
	let leaseFailure: Error | null = null;
	const timer = setInterval(() => {
		if (inFlight || abortController.signal.aborted) return;
		inFlight = (async () => {
			const { data, error } = await supabase.rpc("heartbeat_crawl_run", {
				p_run_id: handle.runId,
				p_lock_token: handle.lockToken,
			});
			if (error) {
				consecutiveErrors += 1;
				console.error(
					`[crawl-source] heartbeat failed run=${handle.runId} consecutive=${consecutiveErrors}: ${error.message}`
				);
				if (consecutiveErrors >= 2) {
					leaseFailure = new Error("크롤링 잠금 heartbeat가 연속으로 실패했습니다.");
					leaseFailure.name = "CrawlLeaseError";
					abortController.abort(leaseFailure);
				}
				return;
			}
			consecutiveErrors = 0;
			if (!((data ?? {}) as { renewed?: boolean }).renewed) {
				leaseFailure = new Error("크롤링 잠금 소유권을 잃었습니다.");
				leaseFailure.name = "CrawlLeaseError";
				abortController.abort(leaseFailure);
			}
		})().finally(() => {
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

	return {
		status,
		retryCount,
		recoveredCount: Math.max(0, Number(crawlData?.recoveredCount ?? 0)),
		attemptedCount: Math.max(0, Number(crawlData?.attempted ?? 0)),
		succeededCount: Math.max(0, Number(crawlData?.succeeded ?? 0)),
		extractedCount: Array.isArray(crawlData?.items) ? crawlData.items.length : 0,
		insertedCount: Math.max(0, insertedCount),
		skippedCount: Math.max(0, skippedCount),
		warningCount: countActionableCrawlWarnings(warnings),
		failureCount: failures.length,
		...failureCounts,
		parserValidCount: Math.max(0, Number(crawlData?.parserValidCount ?? 0)),
		parserMinimumCount: Math.max(0, Number(crawlData?.parserMinimumCount ?? 0)),
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

async function releaseCrawlLockFallback(supabase: SupabaseClient, handle: CrawlRunHandle) {
	const { error } = await supabase.rpc("release_crawl_lock", {
		p_lock_key: handle.lockKey,
		p_lock_token: handle.lockToken,
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

		const run = await beginCrawlRun(context.supabase, context.target, context.trigger);
		if (run instanceof Response) {
			return run;
		}

		const abortController = new AbortController();
		const budgetTimer = setTimeout(
			() => {
				abortController.abort(new DOMException("Crawl run budget exceeded.", "TimeoutError"));
			},
			run.runBudgetSeconds * 1000 + 5000
		);
		const heartbeat = startLeaseHeartbeat(context.supabase, run, abortController);
		let heartbeatStopped = false;
		const stopHeartbeat = async () => {
			if (heartbeatStopped) return;
			heartbeatStopped = true;
			await heartbeat.stop();
		};
		let finalized = false;
		try {
			const processed = await processCrawl(context, run, abortController.signal);
			const leaseFailure = heartbeat.getFailure();
			if (leaseFailure) throw leaseFailure;
			const status = getCompletedRunStatus(
				processed.crawlData.failures,
				processed.crawlData.warnings
			);
			await stopHeartbeat();
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
			await stopHeartbeat();
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
			clearTimeout(budgetTimer);
			await stopHeartbeat();
			if (!finalized) {
				await releaseCrawlLockFallback(context.supabase, run);
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
