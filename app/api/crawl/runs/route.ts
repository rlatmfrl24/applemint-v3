import { type NextRequest, NextResponse } from "next/server";
import { isCrawlRunsDashboard, parseDashboardLimit } from "@/lib/crawl-run-contract";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
		if (!isRecord(data) || !Array.isArray(data.sources) || !Array.isArray(data.runs)) {
			return NextResponse.json(
				{ error: "크롤링 실행 이력 응답이 올바르지 않습니다." },
				{ status: 500 }
			);
		}
		const { data: alertData, error: alertError } = await supabase.rpc("get_crawl_alerts_dashboard");
		if (alertError) {
			console.error("크롤링 장애 알림 조회 실패", alertError.message);
			return NextResponse.json(
				{ error: "크롤링 장애 알림을 조회하지 못했습니다." },
				{ status: 500 }
			);
		}
		if (!isRecord(alertData) || !Array.isArray(alertData.alerts)) {
			return NextResponse.json(
				{ error: "크롤링 장애 알림 응답이 올바르지 않습니다." },
				{ status: 500 }
			);
		}

		const alerts: unknown[] = alertData.alerts;
		const dashboard = {
			...data,
			sources: data.sources.filter(isRecord).map((source: Record<string, unknown>) => ({
				...source,
				activeAlertCount: alerts.filter(
					(alert: unknown) => isRecord(alert) && alert.source === source.source
				).length,
			})),
			alerts,
			alertSettings: alertData.alertSettings,
		};
		if (!isCrawlRunsDashboard(dashboard)) {
			return NextResponse.json(
				{ error: "크롤링 운영 현황 응답이 올바르지 않습니다." },
				{ status: 500 }
			);
		}

		return NextResponse.json(dashboard);
	} catch (error) {
		console.error(
			"크롤링 실행 이력 API 오류",
			error instanceof Error ? error.message : "Unknown error"
		);
		return NextResponse.json({ error: "크롤링 실행 이력을 조회하지 못했습니다." }, { status: 500 });
	}
}
