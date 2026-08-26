import { type NextRequest, NextResponse } from "next/server";
import {
	hasMinimumInternalSecretLength,
	hasValidInternalSecret,
} from "@/app/api/crawl/internal-auth";
import { pushDispatchRequestSchema, pushDispatchResponseSchema } from "@/contracts/push.schema";
import { parseJsonRequest } from "@/lib/http-json";
import { getInternalSecret } from "@/server/env";
import {
	type ObservedRequestContext,
	observeHttpHandler,
} from "@/server/observability/http-request";
import { getWebPushServerConfiguration } from "@/server/push/configuration";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { runWebPushDispatcher } from "../dispatcher";

export const maxDuration = 60;

async function handlePost(request: NextRequest, { requestId, metrics }: ObservedRequestContext) {
	const expectedSecret = getInternalSecret();
	if (!hasMinimumInternalSecretLength(expectedSecret)) {
		return NextResponse.json(
			pushDispatchResponseSchema.parse({
				error: "내부 Push dispatcher 인증 설정이 완료되지 않았습니다.",
				reason: "configuration-missing",
			}),
			{ status: 503 }
		);
	}
	if (!hasValidInternalSecret(request.headers.get("x-applemint-internal-secret"), expectedSecret)) {
		return NextResponse.json(
			pushDispatchResponseSchema.parse({
				error: "인증되지 않은 Push dispatcher 요청입니다.",
				reason: "invalid-secret",
			}),
			{ status: 401 }
		);
	}

	const body = await parseJsonRequest(request, pushDispatchRequestSchema);
	if (!body.success) {
		return NextResponse.json(
			pushDispatchResponseSchema.parse({ error: "Push dispatcher limit이 올바르지 않습니다." }),
			{ status: 400 }
		);
	}

	const configuration = getWebPushServerConfiguration();
	if (!configuration.enabled) {
		return NextResponse.json(
			pushDispatchResponseSchema.parse({
				error: "Web Push 서버 설정이 중단되어 있습니다.",
				reason: configuration.public.reason,
			}),
			{ status: 503 }
		);
	}

	let serviceRoleClient: ReturnType<typeof createServiceRoleClient>;
	try {
		serviceRoleClient = createServiceRoleClient();
	} catch {
		return NextResponse.json(
			pushDispatchResponseSchema.parse({
				error: "Push dispatcher 서버 설정이 완료되지 않았습니다.",
				reason: "configuration-missing",
			}),
			{ status: 503 }
		);
	}

	try {
		const result = await runWebPushDispatcher(serviceRoleClient, configuration, body.data.limit);
		metrics.recordResult(result);
		return NextResponse.json(pushDispatchResponseSchema.parse(result));
	} catch {
		console.error("[push-dispatch] run_failed", {
			requestId,
			code: "PUSH_DISPATCH_FAILED",
		});
		return NextResponse.json(
			pushDispatchResponseSchema.parse({
				error: "Web Push 발송을 처리하지 못했습니다.",
			}),
			{ status: 500 }
		);
	}
}

export const POST = observeHttpHandler<NextRequest>(
	{ transport: "internal-rest", operation: "push.dispatch" },
	handlePost
);
