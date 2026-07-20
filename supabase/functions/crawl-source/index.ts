/// <reference lib="deno.ns" />

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
	type CrawlTarget,
	chunkUrlsForHistoryQuery,
	constantTimeEquals,
	countCrawlWarnings,
	dedupeByUrl,
	defineType,
	type FilterKeyword,
	hasMinimumInternalSecretLength,
	isCrawlTarget,
} from "./helpers.ts";

const CRAWL_LOCK_KEY = "global-crawl";
const CRAWL_LOCK_TTL_SECONDS = 300;
const CRAWL_API_TIMEOUT_MS = 90_000;
const CRAWL_API_BASE_URL = (
	Deno.env.get("CRAWL_API_BASE_URL") ?? "https://applemint-v3.vercel.app"
).replace(/\/$/, "");

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
}

interface CrawlWarning {
	url: string;
	code: "empty-list" | "below-minimum-items" | "discarded-items";
	message: string;
	count: number;
}

interface CrawlApiResponse {
	target: CrawlTarget;
	items: CrawlItem[];
	attempted: number;
	succeeded: number;
	failures: CrawlFailure[];
	warnings: CrawlWarning[];
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

class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number
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
	const crawlResponse = await fetch(`${CRAWL_API_BASE_URL}/api/crawl`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-applemint-internal-secret": internalSecret,
		},
		body: JSON.stringify({ target }),
		signal: AbortSignal.timeout(CRAWL_API_TIMEOUT_MS),
	});
	const crawlData = (await crawlResponse.json().catch(() => null)) as CrawlApiResponse | null;
	if (!crawlResponse.ok || !crawlData || !Array.isArray(crawlData.items)) {
		const passthroughStatuses = new Set([400, 401, 403, 409, 503, 504]);
		throw new HttpError(
			"크롤링 소스 요청에 실패했습니다.",
			passthroughStatuses.has(crawlResponse.status) ? crawlResponse.status : 502
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

async function processCrawl(context: CrawlRequestContext, startedAt: number) {
	const crawlData = await fetchCrawlData(context.target, context.internalSecret);
	const filterList = await loadFilterKeywords(context.supabase);
	const prepared = await prepareItems(context.supabase, context.target, crawlData, filterList);
	const { data, error } = await context.supabase.rpc("ingest_crawl_items", {
		p_crawl_source: context.target,
		p_items: prepared.items,
	});
	if (error) {
		throw error;
	}

	const counts = (data ?? {}) as { insertedCount?: number; skippedCount?: number };
	return jsonResponse({
		target: context.target,
		insertedCount: Number(counts.insertedCount ?? 0),
		skippedCount: prepared.existingCount + Number(counts.skippedCount ?? 0),
		warningCount: countCrawlWarnings(
			Array.isArray(crawlData.failures) ? crawlData.failures : [],
			Array.isArray(crawlData.warnings) ? crawlData.warnings : []
		),
		durationMs: Date.now() - startedAt,
	});
}

async function runWithCrawlLock(supabase: SupabaseClient, operation: () => Promise<Response>) {
	const lockToken = crypto.randomUUID();
	const { data: acquired, error: lockError } = await supabase.rpc("acquire_crawl_lock", {
		p_lock_key: CRAWL_LOCK_KEY,
		p_lock_token: lockToken,
		p_ttl_seconds: CRAWL_LOCK_TTL_SECONDS,
	});
	if (lockError) {
		throw lockError;
	}
	if (!acquired) {
		return jsonResponse({ error: "다른 크롤링 작업이 이미 실행 중입니다." }, 409);
	}

	try {
		return await operation();
	} finally {
		const { error } = await supabase.rpc("release_crawl_lock", {
			p_lock_key: CRAWL_LOCK_KEY,
			p_lock_token: lockToken,
		});
		if (error) {
			console.error(`[crawl-source] lock release failed: ${error.message}`);
		}
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
	const startedAt = Date.now();
	try {
		const context = await createRequestContext(request);
		if (context instanceof Response) {
			return context;
		}

		return await runWithCrawlLock(context.supabase, () => processCrawl(context, startedAt));
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
