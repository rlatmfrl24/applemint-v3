// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MediaExtensions = [
	// image, movie
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

console.log("Called crawl-source");
interface CrawlItemType {
	url: string;
	title: string;
	description: string;
	host: string;
	type: string;
	tag?: string[];
}

function getYoutubeId(url: string) {
	// get youtube video id from short url
	const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
	const match = url.match(regExp);
	return match && match[2].length === 11 ? match[2] : null;
}

function defineType(
	value: string,
	filterList: {
		value: string;
		method: string;
	}[]
) {
	const targetMethod = filterList.find((filter) => {
		return value.includes(filter.value);
	})?.method;

	// if the url is not a youtube video, then it should be normal
	if (targetMethod === "youtube" && getYoutubeId(value) === null) {
		return "normal";
	}

	// if the url is a media file, then it should be media
	if (targetMethod === "media" && MediaExtensions.some((ext) => value.endsWith(ext))) {
		return "media";
	}

	if (targetMethod) {
		return targetMethod;
	}

	return "normal";
}

async function getMediaData(item: CrawlItemType) {
	// case 1: direct image url
	if (item.url.match(/\.(jpeg|jpg|gif|png)$/) != null) {
		return [item.url];
	}

	// case 2: direct video url
	if (item.url.match(/\.(mp4|webm)$/) != null) {
		return [item.url];
	}

	// case 3: imgur album
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

		console.log("🚀 ~ getMediaData ~ data", data);
		return data.data.images.map((img: { link: string }) => img.link);
	}

	// case 4: imgur image
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

		console.log("🚀 ~ getMediaData ~ data", data);
		return [data.data.link];
	}

	// case 5: etc
	return [];
}

Deno.serve(async (req) => {
	// get target from query parameter
	const url = new URL(req.url);
	const target = url.searchParams.get("target");

	if (!target) {
		return new Response("Target is required", { status: 400 });
	}

	try {
		const response = await fetch(`https://applemint-v3.vercel.app/api/crawl?target=${target}`);
		const json = await response.json();
		const rawList = json as CrawlItemType[];

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

		const { data: filterList, error } = await supabase.from("filter-keyword").select("*");

		const filtered = rawList.filter((item) => {
			// if item's url contains any of the ignore list, then filter it out
			return !filterList
				?.filter((keyword: { method: string }) => keyword.method === "ignore")
				.some((ignore: { value: string }) => {
					return item.url.includes(ignore.value);
				});
		});

		if (error) {
			throw error;
		}

		// remove items that are already in the database
		const { data: existingData, error: existingError } = await supabase
			.from("crawl-history")
			.select("*")
			.eq("crawl_source", target)
			.order("created_at", { ascending: false });

		if (existingError) {
			throw existingError;
		}

		const existingUrls = existingData?.map((item: { url: string }) => item.url) ?? [];
		const newRows = filtered.filter((item) => !existingUrls.includes(item.url));

		// add crawl-history to the database
		const { error: insertError } = await supabase.from("crawl-history").insert(
			newRows.map((item) => ({
				url: item.url,
				crawl_source: target,
				host: item.host,
			}))
		);

		if (insertError) {
			throw insertError;
		}

		// pre-process for media items for async actions is all finish
		const InsertRows = await Promise.all(
			newRows.map(async (item) => ({
				url: item.url,
				title: item.title,
				description: item.description,
				host: item.host,
				type: defineType(item.url, filterList),
				sub_url: await getMediaData(item),
				tag: item.tag,
			}))
		);

		console.log("🚀 ~ InsertRows", InsertRows);

		const { error: insertNewError } = await supabase.from("new-threads").insert(
			InsertRows.map((item) => ({
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
				insertedCount: InsertRows?.length,
			}),
			{ headers: { "Content-Type": "application/json" } }
		);
	} catch (err) {
		console.error(err);
		return new Response(String(err?.message ?? err), { status: 500 });
	}
});
