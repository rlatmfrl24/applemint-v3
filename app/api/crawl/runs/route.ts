import { type NextRequest, NextResponse } from "next/server";
import { isCrawlRunsDashboard, parseDashboardLimit } from "@/lib/crawl-run-contract";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
	try {
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}

		const { searchParams } = new URL(request.url);
		const limit = parseDashboardLimit(searchParams.get("limit"));
		const trendLimit = parseDashboardLimit(searchParams.get("trendLimit"));
		if (limit === null || trendLimit === null) {
			return NextResponse.json(
				{ error: "limit과 trendLimit은 1에서 50 사이의 정수여야 합니다." },
				{ status: 400 }
			);
		}

		const { data, error } = await supabase.rpc("get_crawl_runs_dashboard", {
			p_limit: limit,
			p_trend_limit: trendLimit,
		});
		if (error) {
			console.error("크롤링 실행 이력 조회 실패", error.message);
			return NextResponse.json(
				{ error: "크롤링 실행 이력을 조회하지 못했습니다." },
				{ status: 500 }
			);
		}
		if (!isCrawlRunsDashboard(data)) {
			return NextResponse.json(
				{ error: "크롤링 실행 이력 응답이 올바르지 않습니다." },
				{ status: 500 }
			);
		}

		return NextResponse.json(data);
	} catch (error) {
		console.error(
			"크롤링 실행 이력 API 오류",
			error instanceof Error ? error.message : "Unknown error"
		);
		return NextResponse.json({ error: "크롤링 실행 이력을 조회하지 못했습니다." }, { status: 500 });
	}
}
