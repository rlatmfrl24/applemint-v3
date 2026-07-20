import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isCrawlTarget } from "../contracts";
import { hasMinimumInternalSecretLength } from "../internal-auth";

const EDGE_REQUEST_TIMEOUT_MS = 120_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAllowedUserIds() {
	const values = (process.env.CRAWL_ALLOWED_USER_IDS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	if (values.length === 0 || values.some((value) => !UUID_PATTERN.test(value))) {
		return null;
	}

	return new Set(values);
}

function isTimeoutError(error: unknown) {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
	const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const internalSecret = process.env.CRAWL_INTERNAL_SECRET;
	const allowedUserIds = getAllowedUserIds();

	if (
		!supabaseUrl ||
		!serviceRoleKey ||
		!hasMinimumInternalSecretLength(internalSecret) ||
		!allowedUserIds
	) {
		return NextResponse.json(
			{ error: "수동 크롤링 서버 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
	}

	const supabase = await createClient();
	const {
		data: { user },
		error: userError,
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return NextResponse.json({ error: "로그인이 필요한 요청입니다." }, { status: 401 });
	}

	if (!allowedUserIds.has(user.id)) {
		return NextResponse.json({ error: "수동 크롤링 권한이 없습니다." }, { status: 403 });
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
