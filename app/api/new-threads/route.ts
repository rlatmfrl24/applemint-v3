import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

interface ListQueryParams {
	scope: "normal" | "media" | "youtube";
	limit: number;
	cursor: string | null;
	filterType: string | null;
	issuelinkCategory: string | null;
}

function parseQuery(request: NextRequest): ListQueryParams {
	const { searchParams } = new URL(request.url);
	const rawScope = searchParams.get("scope") ?? "normal";
	const scope = rawScope === "media" || rawScope === "youtube"
		? rawScope
		: "normal";

	const limitParam = Number.parseInt(searchParams.get("limit") ?? "20", 10);
	const limit = Number.isNaN(limitParam) || limitParam <= 0
		? 20
		: Math.min(limitParam, 100);

	const cursor = searchParams.get("cursor");
	const filterType = searchParams.get("filterType");
	const issuelinkCategory = searchParams.get("issuelinkCategory");

	return { scope, limit, cursor, filterType, issuelinkCategory };
}

export async function GET(request: NextRequest) {
	try {
		const params = parseQuery(request);
		const supabase = await createClient();
		const {
			data: { user },
			error: userError,
		} = await supabase.auth.getUser();
		if (userError) {
			return NextResponse.json({ error: userError.message }, {
				status: 401,
			});
		}
		if (!user) {
			return NextResponse.json({ error: "인증되지 않은 요청입니다." }, {
				status: 401,
			});
		}

		let query = supabase
			.from("new-threads")
			.select(
				"id, type, url, title, description, host, tag, sub_url, created_at",
			)
			.order("created_at", { ascending: false })
			.order("id", { ascending: false });

		if (params.scope === "media") {
			query = query.eq("type", "media");
		} else if (params.scope === "youtube") {
			query = query.eq("type", "youtube");
		} else {
			query = query.neq("type", "media").neq("type", "youtube");

			if (params.filterType) {
				if (params.filterType === "issuelink") {
					query = query.eq("type", "issuelink");
					if (params.issuelinkCategory) {
						query = query.eq("tag->>1", params.issuelinkCategory);
					}
				} else {
					query = query.eq("type", params.filterType);
				}
			}
		}

		if (params.cursor) {
			const cursorValue = Number.parseInt(params.cursor, 10);
			if (!Number.isNaN(cursorValue)) {
				query = query.lt("id", cursorValue);
			}
		}

		const { data, error } = await query.limit(params.limit + 1);

		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}

		const rows = (data ?? []) as { id: string }[];
		if (rows.length === 0) {
			return NextResponse.json({
				scope: params.scope,
				items: [],
				nextCursor: null,
			});
		}
		const hasMore = rows.length > params.limit;
		const items = hasMore ? rows.slice(0, params.limit) : rows;
		const lastItem = items.at(-1);
		const nextCursor = hasMore && lastItem ? String(lastItem.id) : null;

		return NextResponse.json({
			scope: params.scope,
			items,
			nextCursor,
		});
	} catch (error) {
		console.error("신규 스레드 목록 조회 실패", error);
		return NextResponse.json(
			{ error: "신규 스레드 데이터를 불러오지 못했습니다." },
			{ status: 500 },
		);
	}
}
