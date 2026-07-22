import { type NextRequest, NextResponse } from "next/server";
import { isCrawlPolicySettings, isCrawlPolicySource } from "@/lib/crawl-policy-contract";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

interface PolicyUpdateBody {
	scheduleEnabled: boolean;
	cooldownSeconds: number;
	expectedUpdatedAt: string;
}

function parseUpdateBody(value: unknown): PolicyUpdateBody | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	const keys = Object.keys(body).sort();
	if (keys.join(",") !== "cooldownSeconds,expectedUpdatedAt,scheduleEnabled") return null;
	if (
		typeof body.scheduleEnabled !== "boolean" ||
		typeof body.cooldownSeconds !== "number" ||
		!Number.isInteger(body.cooldownSeconds) ||
		body.cooldownSeconds < 1800 ||
		body.cooldownSeconds > 604800 ||
		body.cooldownSeconds % 60 !== 0 ||
		typeof body.expectedUpdatedAt !== "string" ||
		!Number.isFinite(Date.parse(body.expectedUpdatedAt))
	) {
		return null;
	}
	return body as unknown as PolicyUpdateBody;
}

function policyUpdateResponse(data: unknown, error: { code?: string; message: string } | null) {
	if (error) {
		console.error("수집 정책 수정 실패", error.message);
		const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500;
		return NextResponse.json(
			{ error: status === 500 ? "수집 정책을 저장하지 못했습니다." : error.message },
			{ status }
		);
	}

	const result = data as Record<string, unknown> | null;
	if (!result || !isCrawlPolicySettings(result.settings)) {
		return NextResponse.json(
			{ error: "수집 정책 수정 응답이 올바르지 않습니다." },
			{ status: 500 }
		);
	}
	if (result.updated !== true) {
		return NextResponse.json(
			{
				error: "다른 화면에서 정책이 변경되었습니다. 최신 값을 확인해주세요.",
				settings: result.settings,
			},
			{ status: 409 }
		);
	}
	return NextResponse.json(result.settings);
}

export async function PATCH(
	request: NextRequest,
	context: { params: Promise<{ source: string }> }
) {
	try {
		const { source } = await context.params;
		if (!isCrawlPolicySource(source)) {
			return NextResponse.json({ error: "지원하지 않는 수집 소스입니다." }, { status: 400 });
		}

		const body = parseUpdateBody(await request.json().catch(() => null));
		if (!body) {
			return NextResponse.json(
				{ error: "수집 주기는 30분에서 7일 사이의 1분 단위 값이어야 합니다." },
				{ status: 400 }
			);
		}

		const supabase = await createClient();
		const ownerAccess = await checkApplemintOwner(supabase);
		if (ownerAccess.kind !== "owner") {
			return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
		}

		const { data, error } = await supabase.rpc("update_crawl_source_policy", {
			p_source: source,
			p_schedule_enabled: body.scheduleEnabled,
			p_cooldown_seconds: body.cooldownSeconds,
			p_expected_updated_at: body.expectedUpdatedAt,
		});
		return policyUpdateResponse(data, error);
	} catch (error) {
		console.error(
			"수집 정책 수정 API 오류",
			error instanceof Error ? error.message : "Unknown error"
		);
		return NextResponse.json({ error: "수집 정책을 저장하지 못했습니다." }, { status: 500 });
	}
}
