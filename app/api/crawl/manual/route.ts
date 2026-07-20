import { type NextRequest, NextResponse } from "next/server";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";
import { isCrawlTarget } from "../contracts";
import { hasMinimumInternalSecretLength } from "../internal-auth";

const EDGE_REQUEST_TIMEOUT_MS = 120_000;

function isTimeoutError(error: unknown) {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
	const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const internalSecret = process.env.CRAWL_INTERNAL_SECRET;

	const supabase = await createClient();
	const ownerAccess = await checkApplemintOwner(supabase);
	if (ownerAccess.kind !== "owner") {
		return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
	}

	if (!supabaseUrl || !serviceRoleKey || !hasMinimumInternalSecretLength(internalSecret)) {
		return NextResponse.json(
			{ error: "수동 크롤링 서버 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
	}

	const body = (await request.json().catch(() => null)) as { target?: unknown } | null;
	if (!isCrawlTarget(body?.target)) {
		return NextResponse.json({ error: "지원하지 않는 크롤링 대상입니다." }, { status: 400 });
	}

	try {
		const response = await fetch(`${supabaseUrl}/functions/v1/crawl-source`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${serviceRoleKey}`,
				apikey: serviceRoleKey,
				"Content-Type": "application/json",
				"x-applemint-internal-secret": internalSecret,
			},
			body: JSON.stringify({ target: body.target }),
			signal: AbortSignal.timeout(EDGE_REQUEST_TIMEOUT_MS),
		});
		const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;

		return NextResponse.json(data ?? { error: "크롤러가 올바르지 않은 응답을 반환했습니다." }, {
			status: response.status,
		});
	} catch (error) {
		if (isTimeoutError(error)) {
			return NextResponse.json({ error: "크롤링 요청 시간이 초과되었습니다." }, { status: 504 });
		}

		console.error(
			"수동 크롤러 API 호출 실패:",
			error instanceof Error ? error.message : "Unknown error"
		);
		return NextResponse.json({ error: "크롤러 API 호출에 실패했습니다." }, { status: 500 });
	}
}
