import { NextResponse } from "next/server";
import { isCrawlPolicySettings } from "@/lib/crawl-policy-contract";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
	try {
		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}

		const { data, error } = await supabase.rpc("get_crawl_source_policy_settings");
		if (error) {
			console.error("수집 정책 조회 실패", error.message);
			return NextResponse.json({ error: "수집 정책을 조회하지 못했습니다." }, { status: 500 });
		}
		if (!isCrawlPolicySettings(data)) {
			return NextResponse.json({ error: "수집 정책 응답이 올바르지 않습니다." }, { status: 500 });
		}

		return NextResponse.json(data);
	} catch (error) {
		console.error("수집 정책 API 오류", error instanceof Error ? error.message : "Unknown error");
		return NextResponse.json({ error: "수집 정책을 조회하지 못했습니다." }, { status: 500 });
	}
}
