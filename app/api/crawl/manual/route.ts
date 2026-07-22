import { type NextRequest, NextResponse } from "next/server";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { isCrawlTarget } from "../contracts";
import { resolveCrawlExecutionMode } from "../execution-mode";
import { hasMinimumInternalSecretLength } from "../internal-auth";
import { CrawlPipelineError, executeCrawlPipeline } from "../pipeline";

const EDGE_REQUEST_TIMEOUT_MS = 55_000;

export const maxDuration = 60;

function isTimeoutError(error: unknown) {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function pipelineErrorResponse(error: CrawlPipelineError) {
	if (error.httpStatus === 409) {
		return NextResponse.json(
			{
				error: error.message,
				activeRunId: error.activeRunId ?? null,
			},
			{ status: 409 }
		);
	}

	const message =
		error.httpStatus === 504 ? "크롤링 요청 시간이 초과되었습니다." : "크롤링 처리에 실패했습니다.";
	return NextResponse.json(
		{
			...(error.runId ? { runId: error.runId, status: "failed" } : {}),
			error: message,
		},
		{ status: error.httpStatus }
	);
}

async function invokeLegacyEdge(target: string) {
	const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const internalSecret = process.env.CRAWL_INTERNAL_SECRET;

	if (!supabaseUrl || !serviceRoleKey || !hasMinimumInternalSecretLength(internalSecret)) {
		return NextResponse.json(
			{ error: "수동 크롤링 서버 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
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
			body: JSON.stringify({ target, trigger: "manual" }),
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

export async function POST(request: NextRequest): Promise<NextResponse> {
	const supabase = await createClient();
	const ownerAccess = await checkApplemintOwner(supabase);
	if (ownerAccess.kind !== "owner") {
		return NextResponse.json({ error: ownerAccess.message }, { status: ownerAccess.status });
	}

	const body = (await request.json().catch(() => null)) as { target?: unknown } | null;
	if (!isCrawlTarget(body?.target)) {
		return NextResponse.json({ error: "지원하지 않는 크롤링 대상입니다." }, { status: 400 });
	}

	const executionMode = resolveCrawlExecutionMode();
	if (!executionMode) {
		console.error("[crawl] invalid_execution_mode", {
			configuredMode: process.env.CRAWL_EXECUTION_MODE,
		});
		return NextResponse.json(
			{ error: "크롤링 실행 모드 설정이 올바르지 않습니다." },
			{ status: 503 }
		);
	}
	if (executionMode === "edge") {
		return invokeLegacyEdge(body.target);
	}

	let serviceRoleClient: ReturnType<typeof createServiceRoleClient>;
	try {
		serviceRoleClient = createServiceRoleClient();
	} catch (error) {
		console.error("[crawl] next_configuration_failed", {
			message: error instanceof Error ? error.message : "Unknown error",
		});
		return NextResponse.json(
			{ error: "수동 크롤링 서버 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
	}

	try {
		const result = await executeCrawlPipeline(body.target, serviceRoleClient);
		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof CrawlPipelineError) {
			return pipelineErrorResponse(error);
		}
		console.error("[crawl] unexpected_request_failure", {
			message: error instanceof Error ? error.message : "Unknown error",
		});
		return NextResponse.json({ error: "크롤링 처리에 실패했습니다." }, { status: 500 });
	}
}
