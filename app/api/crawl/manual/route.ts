import { type NextRequest, NextResponse } from "next/server";
import {
	crawlCommandRequestSchema,
	manualCrawlResponseSchema,
} from "@/contracts/crawl-command.schema";
import { parseJsonRequest } from "@/lib/http-json";
import {
	type ObservedRequestContext,
	observeHttpHandler,
} from "@/server/observability/http-request";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { CrawlPipelineError, executeCrawlPipeline } from "../pipeline";

export const maxDuration = 60;

function pipelineErrorResponse(error: CrawlPipelineError) {
	if (error.httpStatus === 409) {
		return NextResponse.json(
			manualCrawlResponseSchema.parse({
				error: error.message,
				activeRunId: error.activeRunId ?? null,
			}),
			{ status: 409 }
		);
	}

	const message =
		error.httpStatus === 504 ? "크롤링 요청 시간이 초과되었습니다." : "크롤링 처리에 실패했습니다.";
	return NextResponse.json(
		manualCrawlResponseSchema.parse({
			...(error.runId ? { runId: error.runId, status: "failed" } : {}),
			error: message,
		}),
		{ status: error.httpStatus }
	);
}

async function handlePost(
	request: NextRequest,
	{ requestId, metrics }: ObservedRequestContext
): Promise<NextResponse> {
	const supabase = await createClient();
	const ownerAccess = await checkApplemintOwner(supabase, metrics);
	if (ownerAccess.kind !== "owner") {
		return NextResponse.json(manualCrawlResponseSchema.parse({ error: ownerAccess.message }), {
			status: ownerAccess.status,
		});
	}

	const body = await parseJsonRequest(request, crawlCommandRequestSchema);
	if (!body.success) {
		return NextResponse.json(
			manualCrawlResponseSchema.parse({ error: "지원하지 않는 크롤링 대상입니다." }),
			{ status: 400 }
		);
	}

	let serviceRoleClient: ReturnType<typeof createServiceRoleClient>;
	try {
		serviceRoleClient = createServiceRoleClient();
	} catch (error) {
		console.error("[crawl] next_configuration_failed", {
			requestId,
			message: error instanceof Error ? error.message : "Unknown error",
		});
		return NextResponse.json(
			manualCrawlResponseSchema.parse({
				error: "수동 크롤링 서버 설정이 완료되지 않았습니다.",
			}),
			{ status: 503 }
		);
	}

	try {
		const result = await executeCrawlPipeline(body.data.target, serviceRoleClient, undefined, {
			requestId,
		});
		metrics.recordResult(result);
		return NextResponse.json(manualCrawlResponseSchema.parse(result));
	} catch (error) {
		if (error instanceof CrawlPipelineError) {
			return pipelineErrorResponse(error);
		}
		console.error("[crawl] unexpected_request_failure", {
			requestId,
			message: error instanceof Error ? error.message : "Unknown error",
		});
		return NextResponse.json(
			manualCrawlResponseSchema.parse({ error: "크롤링 처리에 실패했습니다." }),
			{ status: 500 }
		);
	}
}

export const POST = observeHttpHandler<NextRequest>(
	{ transport: "internal-rest", operation: "crawl.manual" },
	handlePost
);
