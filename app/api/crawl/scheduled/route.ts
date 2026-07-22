import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { isCrawlTarget } from "../contracts";
import { resolveCrawlExecutionMode } from "../execution-mode";
import { hasMinimumInternalSecretLength, hasValidInternalSecret } from "../internal-auth";
import { CrawlPipelineError, executeCrawlPipeline } from "../pipeline";

const EDGE_REQUEST_TIMEOUT_MS = 55_000;

export const maxDuration = 60;

function skippedResponse(target: string, error: CrawlPipelineError) {
	return NextResponse.json({
		status: "skipped",
		target,
		reason: error.admissionReason,
		nextEligibleAt: error.nextEligibleAt ?? null,
		activeRunId: error.activeRunId ?? null,
	});
}

function pipelineErrorResponse(target: string, error: CrawlPipelineError) {
	if (
		error.admissionReason === "disabled" ||
		error.admissionReason === "cooldown" ||
		error.admissionReason === "source-busy"
	) {
		return skippedResponse(target, error);
	}
	if (error.admissionReason === "capacity") {
		return NextResponse.json(
			{
				status: "deferred",
				target,
				reason: "capacity",
				retryAfterSeconds: error.retryAfterSeconds ?? 30,
			},
			{
				status: 429,
				headers: { "Retry-After": String(error.retryAfterSeconds ?? 30) },
			}
		);
	}

	return NextResponse.json(
		{
			...(error.runId ? { runId: error.runId, status: "failed" } : {}),
			target,
			error:
				error.httpStatus === 504
					? "크롤링 요청 시간이 초과되었습니다."
					: "크롤링 처리에 실패했습니다.",
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
			{ error: "예약 크롤링 서버 설정이 완료되지 않았습니다." },
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
			body: JSON.stringify({ target, trigger: "scheduled" }),
			signal: AbortSignal.timeout(EDGE_REQUEST_TIMEOUT_MS),
		});
		const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		return NextResponse.json(data ?? { error: "크롤러가 올바르지 않은 응답을 반환했습니다." }, {
			status: response.status,
			headers: response.headers.has("Retry-After")
				? { "Retry-After": response.headers.get("Retry-After") ?? "30" }
				: undefined,
		});
	} catch (error) {
		const timedOut =
			error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
		return NextResponse.json(
			{
				error: timedOut ? "크롤링 요청 시간이 초과되었습니다." : "크롤러 API 호출에 실패했습니다.",
			},
			{ status: timedOut ? 504 : 500 }
		);
	}
}

export async function POST(request: NextRequest) {
	const expectedSecret = process.env.CRAWL_INTERNAL_SECRET;
	if (!hasMinimumInternalSecretLength(expectedSecret)) {
		return NextResponse.json(
			{ error: "예약 크롤링 인증 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
	}
	if (!hasValidInternalSecret(request.headers.get("x-applemint-internal-secret"), expectedSecret)) {
		return NextResponse.json({ error: "인증되지 않은 예약 크롤링 요청입니다." }, { status: 401 });
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
	} catch {
		return NextResponse.json(
			{ error: "예약 크롤링 서버 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
	}

	try {
		const result = await executeCrawlPipeline(body.target, serviceRoleClient, undefined, {
			trigger: "scheduled",
		});
		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof CrawlPipelineError) {
			return pipelineErrorResponse(body.target, error);
		}
		console.error("[crawl] unexpected_scheduled_failure", {
			message: error instanceof Error ? error.message : "Unknown error",
		});
		return NextResponse.json({ error: "크롤링 처리에 실패했습니다." }, { status: 500 });
	}
}
