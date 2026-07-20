/// <reference lib="deno.ns" />

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
	type CrawlTarget,
	chunkUrlsForHistoryQuery,
	constantTimeEquals,
	dedupeByUrl,
	defineType,
	type FilterKeyword,
	getUrlExtension,
	hasMinimumInternalSecretLength,
	isCrawlTarget,
	MEDIA_EXTENSIONS,
} from "./helpers.ts";

const CRAWL_LOCK_KEY = "global-crawl";
const CRAWL_LOCK_TTL_SECONDS = 300;
const CRAWL_API_TIMEOUT_MS = 90_000;
const MEDIA_FETCH_TIMEOUT_MS = 10_000;
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
}

interface CrawlApiResponse {
	target: CrawlTarget;
	items: CrawlItem[];
	attempted: number;
	succeeded: number;
	failures: CrawlFailure[];
	durationMs: number;
}

interface PreparedCrawlItem extends CrawlItem {
	type: string;
	sub_url: string[];
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

function parseConcurrency(value: string | undefined, fallback: number) {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isNaN(parsed) || parsed <= 0 ? fallback : Math.min(parsed, 20);
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>
) {
	const results = new Array<R>(items.length);
	let cursor = 0;

	const worker = async () => {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await mapper(items[index], index);
		}
	};

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return results;
}

async function fetchImgur(path: string, clientId: string) {
	const response = await fetch(`https://api.imgur.com/3/${path}`, {
		headers: { Authorization: `Client-ID ${clientId}` },
		signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`Imgur API returned HTTP ${response.status}`);
	}

	return (await response.json()) as { data?: unknown };
}

async function expandImgurUrl(itemUrl: string, imgurClientId: string) {
	const parsedUrl = new URL(itemUrl);
	const identifier = parsedUrl.pathname.split("/").filter(Boolean).at(-1)?.split(".")[0];
	if (!identifier) {
		throw new Error("Imgur URL is missing an identifier");
	}

	if (parsedUrl.hostname !== "imgur.com") {
		return [];
	}

	if (parsedUrl.pathname.startsWith("/a/")) {
		const response = await fetchImgur(`album/${identifier}`, imgurClientId);
		if (!response.data || typeof response.data !== "object" || !("images" in response.data)) {
			throw new Error("Imgur album response is missing images");
		}

		const images = (response.data as { images?: unknown }).images;
		if (!Array.isArray(images)) {
			throw new Error("Imgur album images are invalid");
		}

		return images.flatMap((image) =>
			typeof image === "object" && image && "link" in image && typeof image.link === "string"
				? [image.link]
				: []
		);
	}

	const response = await fetchImgur(`image/${identifier}`, imgurClientId);
	if (
		!response.data ||
		typeof response.data !== "object" ||
		!("link" in response.data) ||
		typeof response.data.link !== "string"
	) {
		throw new Error("Imgur image response is missing a link");
	}

	return [response.data.link];
}

async function getMediaData(item: CrawlItem, type: string) {
	if (type !== "media") {
		return { urls: [] as string[], warningCount: 0 };
	}

	const extension = getUrlExtension(item.url);
	if (MEDIA_EXTENSIONS.has(extension)) {
		return { urls: [item.url], warningCount: 0 };
	}

	const imgurClientId = Deno.env.get("NEXT_PUBLIC_IMGUR_CLIENT_ID");
	if (!imgurClientId) {
		return { urls: [] as string[], warningCount: 1 };
	}

	try {
		return { urls: await expandImgurUrl(item.url, imgurClientId), warningCount: 0 };
	} catch (error) {
		console.error(`[crawl-source] media expansion failed: ${getErrorMessage(error)}`);
		return { urls: [] as string[], warningCount: 1 };
	}
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
	const mediaConcurrency = parseConcurrency(Deno.env.get("MEDIA_FETCH_CONCURRENCY"), 6);
	let mediaWarningCount = 0;
	const items = await mapWithConcurrency(
		newItems,
		mediaConcurrency,
		async (item): Promise<PreparedCrawlItem> => {
			const type = defineType(item.url, filterList);
			const media = await getMediaData(item, type);
			mediaWarningCount += media.warningCount;

			return { ...item, type, sub_url: media.urls };
		}
	);

	return { items, existingCount: existingUrls.size, mediaWarningCount };
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
		warningCount:
			(Array.isArray(crawlData.failures) ? crawlData.failures.length : 0) +
			prepared.mediaWarningCount,
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
