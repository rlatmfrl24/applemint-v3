import { type NextRequest, NextResponse } from "next/server";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

interface StatsRow {
	key: string;
	label: string;
	count: number;
	total_count: number;
}

export async function GET(request: NextRequest) {
	try {
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}

		const { searchParams } = new URL(request.url);
		const scope = searchParams.get("scope") ?? "normal";
		const filterType = searchParams.get("filterType");
		const issuelinkCategory = searchParams.get("issuelinkCategory");

		const { data, error } = await supabase.rpc("get_new_threads_stats", {
			in_scope: scope,
			in_filter_type: filterType,
			in_issuelink_category: issuelinkCategory,
		});

		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}

		const rows = (data ?? []) as StatsRow[];
		const counts = rows.map((row) => ({
			key: row.key,
			label: row.label,
			count: Number(row.count),
		}));
		const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

		return NextResponse.json({
			scope,
			totalCount,
			counts,
		});
	} catch (error) {
		console.error("신규 스레드 통계 조회 실패", error);
		return NextResponse.json({ error: "신규 스레드 통계 조회에 실패했습니다." }, { status: 500 });
	}
}
