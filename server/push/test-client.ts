import "server-only";

import { pushEndpointInputSchema, pushTestInternalResponseSchema } from "@/contracts/push.schema";
import { DomainError, unexpectedFailure } from "@/server/errors/domain-error";
import type { PushTestSender } from "@/server/services/push.service";

interface PushTestRequestContext {
	requestUrl: string;
	cookie: string | null;
	requestId: string;
}

export function createWebPushTestClient(
	context: PushTestRequestContext,
	fetchImpl: typeof fetch = fetch
): PushTestSender {
	return async (endpoint) => {
		const headers = new Headers({
			"content-type": "application/json",
			"x-request-id": context.requestId,
		});
		if (context.cookie) headers.set("cookie", context.cookie);

		let response: Response;
		try {
			response = await fetchImpl(new URL("/api/push/test", context.requestUrl), {
				method: "POST",
				headers,
				body: JSON.stringify(pushEndpointInputSchema.parse({ endpoint })),
				signal: AbortSignal.timeout(20_000),
			});
		} catch (error) {
			throw new DomainError(
				"UpstreamTimeout",
				"테스트 알림 처리 경로가 일시적으로 응답하지 않습니다.",
				{ reasonCode: "push-test-route-unavailable" },
				error
			);
		}

		const payload = await response.json().catch(() => null);
		const parsed = pushTestInternalResponseSchema.safeParse(payload);
		if (!parsed.success) {
			throw unexpectedFailure("테스트 알림 처리 응답이 올바르지 않습니다.", parsed.error);
		}
		if ("error" in parsed.data) {
			throw new DomainError(parsed.data.code, parsed.data.error, parsed.data.data);
		}
		if (!response.ok) {
			throw unexpectedFailure("테스트 알림 처리 상태가 올바르지 않습니다.");
		}
		return parsed.data;
	};
}
