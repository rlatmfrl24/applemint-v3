import { fetch } from "undici";
import type { CrawlItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
	// The `/api` route is required for the server-side auth flow implemented
	// by the SSR package. It exchanges an auth code for the user's session.
	// https://supabase.com/docs/guides/auth/server-side/nextjs

	console.log("GET /api");

	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) {
		return new Response("Unauthorized", {
			status: 401,
		});
	}

	const target = "insagirl";
	const response = await fetch(
		`https://applemint-v3.vercel.app/api/crawl?target=${target}`,
	);
	const json = await response.json();
	const rawList = json as CrawlItemType[];

	const { data: filterKeywordList } = await supabase.from("filter-keyword")
		.select("*");

	console.log("🚀 ~ GET ~ filterKeywordList:", filterKeywordList);

	const filtered = rawList.filter((item) => {
		return !filterKeywordList
			?.filter((keyword: { method: string }) =>
				keyword.method === "ignore"
			)
			.some((ignore: { value: string }) =>
				item.url.includes(ignore.value)
			);
	});

	const { data: historyData } = await supabase
		.from("crawl-history")
		.select("*")
		.order("created_at", { ascending: false })
		.eq("crawl_source", target);

	const newData = filtered.filter((item) => {
		return !historyData?.some((historyItem) =>
			historyItem.url === item.url
		);
	});

	return new Response(
		JSON.stringify({
			length: newData?.length,
			// filtered,
			newData,
		}),
		{
			headers: {
				"content-type": "application/json",
			},
		},
	);
}
