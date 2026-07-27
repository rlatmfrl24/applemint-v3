import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { isThreadState } from "@/lib/thread-list-contract";
import { getThreadTypeLabel } from "@/lib/thread-type";
import type { ThreadState } from "@/lib/type-defs";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

interface StatsRow {
	key: string;
	label: string;
	count: number;
	total_count: number;
}

const loadStats = (supabase: SupabaseClient, state: ThreadState, filterType: string | null) =>
	supabase.rpc("get_thread_stats", { p_state: state, p_filter_type: filterType });

export async function handleThreadStatsGet(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const state = searchParams.get("state");
		if (!isThreadState(state)) {
			return NextResponse.json({ error: "올바른 스레드 상태가 필요합니다." }, { status: 400 });
		}
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}
		const { data, error } = await loadStats(supabase, state, searchParams.get("filterType"));
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
		const rows = (data ?? []) as StatsRow[];
		return NextResponse.json({
			totalCount: rows.length > 0 ? Number(rows[0].total_count) : 0,
			counts: rows.map((row) => ({
				key: row.key,
				label: getThreadTypeLabel(row.key),
				count: Number(row.count),
			})),
		});
	} catch (error) {
		console.error("스레드 통계 조회 실패", error);
		return NextResponse.json({ error: "스레드 통계 조회에 실패했습니다." }, { status: 500 });
	}
}
