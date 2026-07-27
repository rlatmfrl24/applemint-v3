import { type NextRequest, NextResponse } from "next/server";
import {
	type CrawlTarget,
	crawlCommandRequestSchema,
	scheduledCrawlResponseSchema,
} from "@/contracts/crawl-command.schema";
import { parseJsonRequest } from "@/lib/http-json";
import {
	type ObservedRequestContext,
	observeHttpHandler,
} from "@/server/observability/http-request";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { hasMinimumInternalSecretLength, hasValidInternalSecret } from "../internal-auth";
import { CrawlPipelineError, executeCrawlPipeline } from "../pipeline";

export const maxDuration = 60;

function skippedResponse(target: CrawlTarget, error: CrawlPipelineError) {
	return NextResponse.json(
		scheduledCrawlResponseSchema.parse({
			status: "skipped",
			target,
			reason: error.admissionReason,
			nextEligibleAt: error.nextEligibleAt ?? null,
			activeRunId: error.activeRunId ?? null,
		})
	);
}

function pipelineErrorResponse(target: CrawlTarget, error: CrawlPipelineError) {
	if (
		error.admissionReason === "disabled" ||
		error.admissionReason === "cooldown" ||
		error.admissionReason === "source-busy"
	) {
		return skippedResponse(target, error);
	}
	if (error.admissionReason === "capacity") {
		return NextResponse.json(
			scheduledCrawlResponseSchema.parse({
				status: "deferred",
				target,
				reason: "capacity",
				retryAfterSeconds: error.retryAfterSeconds ?? 30,
			}),
			{
				status: 429,
				headers: { "Retry-After": String(error.retryAfterSeconds ?? 30) },
			}
		);
	}

	return NextResponse.json(
		scheduledCrawlResponseSchema.parse({
			...(error.runId ? { runId: error.runId, status: "failed" } : {}),
			target,
			error:
				error.httpStatus === 504
					? "크롤링 요청 시간이 초과되었습니다."
					: "크롤링 처리에 실패했습니다.",
		}),
		{ status: error.httpStatus }
	);
}

async function handlePost(request: NextRequest, { requestId, metrics }: ObservedRequestContext) {
	const expectedSecret = process.env.CRAWL_INTERNAL_SECRET;
	if (!hasMinimumInternalSecretLength(expectedSecret)) {
		return NextResponse.json(
			scheduledCrawlResponseSchema.parse({
				error: "예약 크롤링 인증 설정이 완료되지 않았습니다.",
				reason: "configuration-missing",
			}),
			{ status: 503 }
		);
	}
	if (!hasValidInternalSecret(request.headers.get("x-applemint-internal-secret"), expectedSecret)) {
		return NextResponse.json(
			scheduledCrawlResponseSchema.parse({
				error: "인증되지 않은 예약 크롤링 요청입니다.",
				reason: "invalid-secret",
			}),
			{ status: 401 }
		);
	}

	const body = await parseJsonRequest(request, crawlCommandRequestSchema);
	if (!body.success) {
		return NextResponse.json(
			scheduledCrawlResponseSchema.parse({ error: "지원하지 않는 크롤링 대상입니다." }),
			{ status: 400 }
		);
	}
	let serviceRoleClient: ReturnType<typeof createServiceRoleClient>;
	try {
		serviceRoleClient = createServiceRoleClient();
	} catch {
		return NextResponse.json(
			scheduledCrawlResponseSchema.parse({
				error: "예약 크롤링 서버 설정이 완료되지 않았습니다.",
			}),
			{ status: 503 }
		);
	}

	try {
		const result = await executeCrawlPipeline(body.data.target, serviceRoleClient, undefined, {
			trigger: "scheduled",
		});
		metrics.recordResult(result);
		return NextResponse.json(scheduledCrawlResponseSchema.parse(result));
	} catch (error) {
		if (error instanceof CrawlPipelineError) {
			return pipelineErrorResponse(body.data.target, error);
		}
		console.error("[crawl] unexpected_scheduled_failure", {
			requestId,
			message: error instanceof Error ? error.message : "Unknown error",
		});
		return NextResponse.json(
			scheduledCrawlResponseSchema.parse({ error: "크롤링 처리에 실패했습니다." }),
			{ status: 500 }
		);
	}
}

export const POST = observeHttpHandler<NextRequest>(
	{ transport: "internal-rest", operation: "crawl.scheduled" },
	handlePost
);
