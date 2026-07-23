import { type NextRequest, NextResponse } from "next/server";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { isCrawlTarget } from "../contracts";
import { CrawlPipelineError, executeCrawlPipeline } from "../pipeline";

export const maxDuration = 60;

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
