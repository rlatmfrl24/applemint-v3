import { type NextRequest, NextResponse } from "next/server";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

interface ListQueryParams {
	limit: number;
	cursor: string | null;
	filterType: string | null;
	issuelinkCategory: string | null;
}

function parseQuery(request: NextRequest): ListQueryParams {
	const { searchParams } = new URL(request.url);
	const limitParam = Number.parseInt(searchParams.get("limit") ?? "20", 10);
	const limit = Number.isNaN(limitParam) || limitParam <= 0 ? 20 : Math.min(limitParam, 100);

	const cursor = searchParams.get("cursor");
	const filterType = searchParams.get("filterType");
	const issuelinkCategory = searchParams.get("issuelinkCategory");

	return { limit, cursor, filterType, issuelinkCategory };
}

export async function GET(request: NextRequest) {
	try {
		const params = parseQuery(request);
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}

		let query = supabase
			.from("new-threads")
			.select("id, type, url, title, description, host, tag, created_at")
			.order("created_at", { ascending: false })
			.order("id", { ascending: false });

		if (params.filterType) {
			query = query.eq("type", params.filterType);
		}
		if (params.filterType === "issuelink" && params.issuelinkCategory) {
			query = query.contains("tag", [params.issuelinkCategory]);
		}

		const cursorValue = Number.parseInt(params.cursor ?? "", 10);
		if (!Number.isNaN(cursorValue)) {
			query = query.lt("id", cursorValue);
		}

		const { data, error } = await query.limit(params.limit + 1);

		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}

		const rows = (data ?? []) as { id: string }[];
		if (rows.length === 0) {
			return NextResponse.json({
				items: [],
				nextCursor: null,
			});
		}
		const hasMore = rows.length > params.limit;
		const items = hasMore ? rows.slice(0, params.limit) : rows;
		const lastItem = items.at(-1);
		const nextCursor = hasMore && lastItem ? String(lastItem.id) : null;

		return NextResponse.json({
			items,
			nextCursor,
		});
	} catch (error) {
		console.error("신규 스레드 목록 조회 실패", error);
		return NextResponse.json(
			{ error: "신규 스레드 데이터를 불러오지 못했습니다." },
			{ status: 500 }
		);
	}
}
