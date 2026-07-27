import { type NextRequest, NextResponse } from "next/server";
import {
	hasMinimumInternalSecretLength,
	hasValidInternalSecret,
} from "@/app/api/crawl/internal-auth";
import {
	createMediaWorkerRequestSchema,
	mediaWorkerResponseSchema,
} from "@/contracts/media-worker.schema";
import { parseJsonRequest } from "@/lib/http-json";
import {
	type ObservedRequestContext,
	observeHttpHandler,
} from "@/server/observability/http-request";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { IMGUR_MAX_BATCH_SIZE, ImgurWorkerError, runImgurEnrichmentWorker } from "../worker";

export const maxDuration = 60;

const requestSchema = createMediaWorkerRequestSchema(IMGUR_MAX_BATCH_SIZE);

async function handlePost(request: NextRequest, { requestId, metrics }: ObservedRequestContext) {
	const expectedSecret = process.env.CRAWL_INTERNAL_SECRET;
	if (!hasMinimumInternalSecretLength(expectedSecret)) {
		return NextResponse.json(
			mediaWorkerResponseSchema.parse({
				error: "내부 worker 인증 설정이 완료되지 않았습니다.",
				reason: "configuration-missing",
			}),
			{ status: 503 }
		);
	}
	if (!hasValidInternalSecret(request.headers.get("x-applemint-internal-secret"), expectedSecret)) {
		return NextResponse.json(
			mediaWorkerResponseSchema.parse({
				error: "인증되지 않은 Imgur worker 요청입니다.",
				reason: "invalid-secret",
			}),
			{ status: 401 }
		);
	}

	const clientId = process.env.IMGUR_CLIENT_ID?.trim();
	if (!clientId) {
		return NextResponse.json(
			mediaWorkerResponseSchema.parse({
				error: "Imgur API 서버 설정이 완료되지 않았습니다.",
				reason: "configuration-missing",
			}),
			{ status: 503 }
		);
	}

	const body = await parseJsonRequest(request, requestSchema);
	if (!body.success) {
		return NextResponse.json(
			mediaWorkerResponseSchema.parse({ error: "Imgur worker limit이 올바르지 않습니다." }),
			{ status: 400 }
		);
	}

	let serviceRoleClient: ReturnType<typeof createServiceRoleClient>;
	try {
		serviceRoleClient = createServiceRoleClient();
	} catch {
		return NextResponse.json(
			mediaWorkerResponseSchema.parse({
				error: "Imgur worker 서버 설정이 완료되지 않았습니다.",
				reason: "configuration-missing",
			}),
			{ status: 503 }
		);
	}

	try {
		const result = await runImgurEnrichmentWorker(serviceRoleClient, {
			clientId,
			limit: body.data.limit,
		});
		metrics.recordResult(result);
		return NextResponse.json(mediaWorkerResponseSchema.parse(result));
	} catch (error) {
		console.error("[imgur-worker] run_failed", {
			requestId,
			code: error instanceof ImgurWorkerError ? error.code : "IMGUR_WORKER_FAILED",
		});
		return NextResponse.json(
			mediaWorkerResponseSchema.parse({ error: "Imgur metadata 처리에 실패했습니다." }),
			{ status: 500 }
		);
	}
}

export const POST = observeHttpHandler<NextRequest>(
	{ transport: "internal-rest", operation: "media.imgur.enrich" },
	handlePost
);
