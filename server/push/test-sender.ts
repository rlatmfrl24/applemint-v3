import type { SupabaseClient } from "@supabase/supabase-js";
import webPush from "web-push";
import {
	invalidatePushSubscriptionResultSchema,
	type PushTestClaimResult,
	pushSendTestResultSchema,
	pushTestClaimResultSchema,
	type WebPushTestPayload,
	webPushTestPayloadSchema,
} from "@/contracts/push.schema";
import { DomainError, unexpectedFailure } from "@/server/errors/domain-error";
import type { WebPushServerConfiguration } from "@/server/push/configuration";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

const PUSH_TEST_TIMEOUT_MS = 15_000;

type EnabledWebPushConfiguration = Extract<WebPushServerConfiguration, { enabled: true }>;
type SendNotification = typeof webPush.sendNotification;

interface WebPushTestDependencies {
	createClient?: () => SupabaseClient;
	now?: () => Date;
	sendNotification?: SendNotification;
	setVapidDetails?: typeof webPush.setVapidDetails;
}

async function callRpc<T>(
	supabase: SupabaseClient,
	name: string,
	parameters: Record<string, unknown>,
	parse: (value: unknown) => T
) {
	const { data, error } = await supabase.rpc(name, parameters);
	if (error) {
		throw unexpectedFailure("테스트 알림 상태를 처리하지 못했습니다.", error);
	}
	try {
		return parse(data);
	} catch (error) {
		throw unexpectedFailure("테스트 알림 상태 응답이 올바르지 않습니다.", error);
	}
}

function resolveClaimFailure(claim: Exclude<PushTestClaimResult, { status: "claimed" }>) {
	if (claim.status === "cooldown") {
		return new DomainError(
			"CapacityExceeded",
			`테스트 알림은 ${claim.retryAfterSeconds}초 후 다시 보낼 수 있습니다.`,
			{ retryAfterSeconds: claim.retryAfterSeconds, reasonCode: "push-test-cooldown" }
		);
	}
	return new DomainError("StateConflict", "이 기기의 알림 구독을 다시 연결한 뒤 테스트해주세요.", {
		reasonCode: "push-subscription-inactive",
	});
}

function getPushStatusCode(error: unknown) {
	if (
		typeof error === "object" &&
		error !== null &&
		"statusCode" in error &&
		typeof error.statusCode === "number"
	) {
		return error.statusCode;
	}
	return null;
}

function isTemporaryPushFailure(statusCode: number | null) {
	return (
		statusCode === null ||
		statusCode === 408 ||
		statusCode === 429 ||
		(statusCode !== null && statusCode >= 500 && statusCode <= 599)
	);
}

async function invalidateClaim(
	supabase: SupabaseClient,
	claim: Extract<PushTestClaimResult, { status: "claimed" }>,
	statusCode: 404 | 410
) {
	return callRpc(
		supabase,
		"invalidate_web_push_test_subscription",
		{
			p_subscription_id: claim.subscriptionId,
			p_error_code: `push-${statusCode}`,
		},
		(value) => invalidatePushSubscriptionResultSchema.parse(value)
	);
}

export async function sendWebPushTest(
	endpoint: string,
	configuration: EnabledWebPushConfiguration,
	dependencies: WebPushTestDependencies = {}
) {
	const supabase = (dependencies.createClient ?? createServiceRoleClient)();
	const claim = await callRpc(
		supabase,
		"claim_web_push_test_subscription",
		{ p_endpoint: endpoint, p_cooldown_seconds: 60 },
		(value) => pushTestClaimResultSchema.parse(value)
	);
	if (claim.status !== "claimed") {
		throw resolveClaimFailure(claim);
	}

	const payload: WebPushTestPayload = webPushTestPayloadSchema.parse({
		v: 1,
		type: "test",
		url: "/main/setting/app",
	});
	(dependencies.setVapidDetails ?? webPush.setVapidDetails)(
		configuration.subject,
		configuration.publicKey,
		configuration.privateKey
	);

	try {
		await (dependencies.sendNotification ?? webPush.sendNotification)(
			{
				endpoint: claim.endpoint,
				keys: { p256dh: claim.p256dh, auth: claim.auth },
			},
			JSON.stringify(payload),
			{ TTL: 60, urgency: "high", timeout: PUSH_TEST_TIMEOUT_MS }
		);
	} catch (error) {
		const statusCode = getPushStatusCode(error);
		if (statusCode === 404 || statusCode === 410) {
			const invalidation = await invalidateClaim(supabase, claim, statusCode);
			console.info("[push-test] subscription invalidated", {
				subscriptionId: claim.subscriptionId,
				statusCode,
				invalidated: invalidation.invalidated,
				skippedCount: invalidation.skippedCount,
			});
			throw new DomainError(
				"StateConflict",
				"Push 서비스에서 이 기기의 구독이 만료되었습니다. 알림을 다시 연결해주세요.",
				{ reasonCode: "push-subscription-invalid" }
			);
		}

		console.info("[push-test] delivery failed", {
			subscriptionId: claim.subscriptionId,
			statusCode: statusCode ?? "network",
		});
		if (isTemporaryPushFailure(statusCode)) {
			throw new DomainError(
				"UpstreamTimeout",
				"Push 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
				{ reasonCode: "push-test-upstream-unavailable" }
			);
		}
		throw unexpectedFailure("테스트 알림을 보내지 못했습니다.");
	}

	const result = pushSendTestResultSchema.parse({
		sent: true,
		sentAt: (dependencies.now ?? (() => new Date()))().toISOString(),
	});
	console.info("[push-test] delivered", {
		subscriptionId: claim.subscriptionId,
		sentAt: result.sentAt,
	});
	return result;
}
