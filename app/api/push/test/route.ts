import { type NextRequest, NextResponse } from "next/server";
import {
	pushEndpointInputSchema,
	pushSendTestResultSchema,
	pushTestInternalResponseSchema,
} from "@/contracts/push.schema";
import { parseJsonRequest } from "@/lib/http-json";
import { DomainError, type DomainErrorCode } from "@/server/errors/domain-error";
import {
	type ObservedRequestContext,
	observeHttpHandler,
} from "@/server/observability/http-request";
import { getWebPushServerConfiguration } from "@/server/push/configuration";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

export const maxDuration = 30;

const statusByCode: Record<DomainErrorCode, number> = {
	InvalidInput: 400,
	Unauthenticated: 401,
	Forbidden: 403,
	NotFound: 404,
	StateConflict: 409,
	CapacityExceeded: 429,
	ConfigurationUnavailable: 503,
	UpstreamTimeout: 503,
	UnexpectedFailure: 500,
};

function errorResponse(error: DomainError, requestId: string) {
	return NextResponse.json(
		pushTestInternalResponseSchema.parse({
			error: error.message,
			code: error.code,
			data: {
				...(error.data.retryAfterSeconds === undefined
					? {}
					: { retryAfterSeconds: error.data.retryAfterSeconds }),
				...(error.data.reasonCode === undefined ? {} : { reasonCode: error.data.reasonCode }),
				requestId,
			},
		}),
		{
			status: statusByCode[error.code],
			headers: { "cache-control": "private, no-store" },
		}
	);
}

async function getOwnerAccessError(metrics: ObservedRequestContext["metrics"]) {
	try {
		const ownerAccess = await checkApplemintOwner(await createClient(), metrics);
		switch (ownerAccess.kind) {
			case "owner":
				return null;
			case "unauthenticated":
				return new DomainError("Unauthenticated", ownerAccess.message);
			case "forbidden":
				return new DomainError("Forbidden", ownerAccess.message);
			case "unavailable":
				return new DomainError("ConfigurationUnavailable", ownerAccess.message, {
					reasonCode: "owner-access-unavailable",
				});
		}
	} catch (error) {
		return new DomainError(
			"ConfigurationUnavailable",
			"소유자 권한을 확인할 수 없습니다.",
			{ reasonCode: "owner-access-unavailable" },
			error
		);
	}
}

async function handlePost(request: NextRequest, { requestId, metrics }: ObservedRequestContext) {
	const ownerAccessError = await getOwnerAccessError(metrics);
	if (ownerAccessError) return errorResponse(ownerAccessError, requestId);

	const body = await parseJsonRequest(request, pushEndpointInputSchema);
	if (!body.success) {
		return errorResponse(
			new DomainError("InvalidInput", "알림 구독 주소가 올바르지 않습니다."),
			requestId
		);
	}

	const configuration = getWebPushServerConfiguration();
	if (!configuration.enabled) {
		return errorResponse(
			new DomainError("ConfigurationUnavailable", "Web Push 서버 설정이 중단되어 있습니다.", {
				reasonCode: configuration.public.reason ?? "configuration-missing",
			}),
			requestId
		);
	}

	try {
		const { sendWebPushTest } = await import("@/server/push/test-sender");
		const result = await sendWebPushTest(body.data.endpoint, configuration);
		metrics.recordResult(result);
		return NextResponse.json(pushSendTestResultSchema.parse(result), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		console.error("[push-test] route_failed", {
			requestId,
			code: error instanceof DomainError ? error.code : "UnexpectedFailure",
		});
		return errorResponse(
			error instanceof DomainError
				? error
				: new DomainError("UnexpectedFailure", "테스트 알림을 보내지 못했습니다.", {}, error),
			requestId
		);
	}
}

export const POST = observeHttpHandler<NextRequest>(
	{ transport: "internal-rest", operation: "push.test" },
	handlePost
);
