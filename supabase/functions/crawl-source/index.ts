import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MEDIA_EXTENSIONS = [
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"bmp",
	"tiff",
	"svg",
	"ico",
	"mp4",
	"webm",
	"mov",
	"avi",
	"mkv",
	"flv",
	"vob",
	"ogv",
	"ogg",
	"drc",
	"mng",
];
const CRAWL_API_BASE_URL = Deno.env.get("CRAWL_API_BASE_URL") ?? "https://applemint-v3.vercel.app";
const LOG_LEVEL = (Deno.env.get("LOG_LEVEL") ?? "").toLowerCase();
const DEBUG_CRAWL_ENABLED =
	Deno.env.get("DEBUG_CRAWL") === "1" ||
	Deno.env.get("DEBUG_CRAWL") === "true" ||
	LOG_LEVEL === "debug";

interface CrawlItemType {
	url: string;
	title: string;
	description: string;
	host: string;
	tag?: string[];
}

type FilterKeyword = {
	value: string;
	method: string;
};

const debugLog = (...args: unknown[]) => {
	if (DEBUG_CRAWL_ENABLED) {
		console.log(...args);
	}
};

function getYoutubeId(url: string) {
	const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
	const match = url.match(regExp);
	return match && match[2].length === 11 ? match[2] : null;
}

function defineType(value: string, filterList: FilterKeyword[]) {
	const targetMethod = filterList.find((filter) => {
		return value.includes(filter.value);
	})?.method;

	if (targetMethod === "youtube" && getYoutubeId(value) === null) {
		return "normal";
	}

	if (targetMethod === "media" && MEDIA_EXTENSIONS.some((ext) => value.endsWith(ext))) {
		return "media";
	}

	if (targetMethod) {
		return targetMethod;
	}

	return "normal";
}

async function getMediaData(item: CrawlItemType) {
	if (item.url.match(/\.(jpeg|jpg|gif|png)$/) != null) {
		return [item.url];
	}

	if (item.url.match(/\.(mp4|webm)$/) != null) {
		return [item.url];
	}

	if (item.url.match(/imgur.com\/a\//) != null) {
		const albumId = item.url.split("/")[item.url.split("/").length - 1];
		const imgurClientId = Deno.env.get("NEXT_PUBLIC_IMGUR_CLIENT_ID");
		if (!imgurClientId) {
			console.error("Missing NEXT_PUBLIC_IMGUR_CLIENT_ID for album fetch");
			return [];
		}
		const response = await fetch(`https://api.imgur.com/3/album/${albumId}`, {
			headers: {
				Authorization: `Client-ID ${imgurClientId}`,
			},
		});

		const data = await response.json();
		debugLog("[crawl-source] album media data fetched", albumId);
		return data.data.images.map((img: { link: string }) => img.link);
	}

	if (item.url.match(/imgur.com\/[^/]+$/) != null) {
		const imageId = item.url.split("/")[item.url.split("/").length - 1];
		const imgurClientId = Deno.env.get("NEXT_PUBLIC_IMGUR_CLIENT_ID");
		if (!imgurClientId) {
			console.error("Missing NEXT_PUBLIC_IMGUR_CLIENT_ID for image fetch");
			return [];
		}

		const response = await fetch(`https://api.imgur.com/3/image/${imageId}`, {
			headers: {
				Authorization: `Client-ID ${imgurClientId}`,
			},
		});

		const data = await response.json();
		debugLog("[crawl-source] image media data fetched", imageId);
		return [data.data.link];
	}

	return [];
}

function parseConcurrency(value: string | undefined, fallback: number) {
	const parsed = Number.parseInt(value ?? "", 10);

	if (Number.isNaN(parsed) || parsed <= 0) {
		return fallback;
	}

	return Math.min(parsed, 20);
}

function dedupeByUrl(items: CrawlItemType[]) {
	const deduped = new Map<string, CrawlItemType>();

	for (const item of items) {
		if (!deduped.has(item.url)) {
			deduped.set(item.url, item);
		}
	}

	return Array.from(deduped.values());
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

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);

	return results;
}

Deno.serve(async (req) => {
	const url = new URL(req.url);
	const target = url.searchParams.get("target");

	if (!target) {
		return new Response("Target is required", { status: 400 });
	}

	try {
		const response = await fetch(`${CRAWL_API_BASE_URL}/api/crawl?target=${target}`);
		if (!response.ok) {
			throw new Error(`crawl api request failed: ${response.status}`);
		}

		const rawList = (await response.json()) as CrawlItemType[];

		const supabase = createClient(
			Deno.env.get("SUPABASE_URL") ?? "",
			Deno.env.get("SUPABASE_ANON_KEY") ?? "",
			{
				global: {
					headers: {
						Authorization: req.headers.get("Authorization") ?? "",
					},
				},
			}
		);

		const { data: filterListData, error: filterError } = await supabase
			.from("filter-keyword")
			.select("*");
		if (filterError) {
			throw filterError;
		}

		const filterList = (filterListData ?? []) as FilterKeyword[];
		const ignoreList = filterList
			.filter((keyword) => keyword.method === "ignore")
			.map((keyword) => keyword.value);

		const filtered = rawList.filter((item) => {
			return !ignoreList.some((ignoreKeyword) => item.url.includes(ignoreKeyword));
		});
		const uniqueFiltered = dedupeByUrl(filtered);

		if (uniqueFiltered.length === 0) {
			return new Response(JSON.stringify({ message: "No new rows", insertedCount: 0 }), {
				headers: { "Content-Type": "application/json" },
			});
		}

		const { data: insertedHistoryRows, error: historyInsertError } = await supabase
			.from("crawl-history")
			.upsert(
				uniqueFiltered.map((item) => ({
					url: item.url,
					crawl_source: target,
					host: item.host,
				})),
				{
					onConflict: "crawl_source,url",
					ignoreDuplicates: true,
				}
			)
			.select("url");

		if (historyInsertError) {
			throw historyInsertError;
		}

		const insertedUrlSet = new Set(
			(insertedHistoryRows ?? []).map((item: { url: string }) => item.url)
		);
		const newRows = uniqueFiltered.filter((item) => insertedUrlSet.has(item.url));

		if (newRows.length === 0) {
			return new Response(JSON.stringify({ message: "No new rows", insertedCount: 0 }), {
				headers: { "Content-Type": "application/json" },
			});
		}

		const mediaFetchConcurrency = parseConcurrency(Deno.env.get("MEDIA_FETCH_CONCURRENCY"), 6);

		const insertRows = await mapWithConcurrency(newRows, mediaFetchConcurrency, async (item) => ({
			url: item.url,
			title: item.title,
			description: item.description,
			host: item.host,
			type: defineType(item.url, filterList),
			sub_url: await getMediaData(item),
			tag: item.tag,
		}));

		debugLog("[crawl-source] rows prepared", insertRows.length);

		const { error: insertNewError } = await supabase.from("new-threads").insert(
			insertRows.map((item) => ({
				url: item.url,
				title: item.title,
				description: item.description,
				host: item.host,
				type: item.type,
				sub_url: item.sub_url,
				tag: item.tag,
			}))
		);

		if (insertNewError) {
			throw insertNewError;
		}

		return new Response(
			JSON.stringify({
				message: "Crawl successful",
				insertedCount: insertRows.length,
			}),
			{ headers: { "Content-Type": "application/json" } }
		);
	} catch (err) {
		console.error("[crawl-source] error", err);
		const message = err instanceof Error ? err.message : String(err);
		return new Response(message, { status: 500 });
	}
});
