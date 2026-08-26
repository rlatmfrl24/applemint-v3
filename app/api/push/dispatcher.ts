import "server-only";

import webPush from "web-push";
import {
	type ClaimedPushDelivery,
	claimedPushDeliveriesSchema,
	invalidatePushSubscriptionResultSchema,
	type PushDispatchResult,
	pushDispatchResultSchema,
	retryPushDeliveryResultSchema,
	type WebPushPayload,
	webPushPayloadSchema,
} from "@/contracts/push.schema";
import type { WebPushServerConfiguration } from "@/server/push/configuration";
import type { Database } from "@/types/database.types";
import type { AppSupabaseClient } from "@/types/supabase";

const MAX_CONCURRENCY = 5;
const PUSH_REQUEST_TIMEOUT_MS = 15_000;

type SendNotification = typeof webPush.sendNotification;

interface DispatcherDependencies {
	sendNotification?: SendNotification;
}

class PushDispatcherError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "PushDispatcherError";
	}
}

function safeErrorCode(error: unknown) {
	const statusCode =
		typeof error === "object" &&
		error !== null &&
		"statusCode" in error &&
		typeof error.statusCode === "number"
			? error.statusCode
			: null;

	if (statusCode !== null) {
		return { statusCode, code: `push-${statusCode}` };
	}
	return { statusCode: null, code: "push-network" };
}

function isRetryablePushFailure(statusCode: number | null) {
	return (
		statusCode === null ||
		statusCode === 408 ||
		statusCode === 429 ||
		(statusCode >= 500 && statusCode <= 599)
	);
}

async function handleDeliveryFailure(
	supabase: AppSupabaseClient,
	delivery: ClaimedPushDelivery,
	failure: ReturnType<typeof safeErrorCode>
) {
	if (failure.statusCode === 404 || failure.statusCode === 410) {
		const result = await callRpc(
			supabase,
			"invalidate_web_push_subscription",
			{
				p_delivery_id: delivery.delivery_id,
				p_lease_token: delivery.delivery_lease_token,
				p_error_code: failure.code,
			},
			(value) => invalidatePushSubscriptionResultSchema.parse(value)
		);
		return {
			state: result.invalidated ? ("invalidated" as const) : ("lease-lost" as const),
			skippedCount: result.skippedCount,
		};
	}

	if (!isRetryablePushFailure(failure.statusCode)) {
		const failed = await callRpc(
			supabase,
			"fail_web_push_delivery",
			{
				p_delivery_id: delivery.delivery_id,
				p_lease_token: delivery.delivery_lease_token,
				p_error_code: failure.code,
			},
			(value) => {
				if (typeof value !== "boolean") throw new Error("Expected boolean.");
				return value;
			}
		);
		return failed ? ("dead" as const) : ("lease-lost" as const);
	}

	const result = await callRpc(
		supabase,
		"retry_web_push_delivery",
		{
			p_delivery_id: delivery.delivery_id,
			p_lease_token: delivery.delivery_lease_token,
			p_error_code: failure.code,
		},
		(value) => retryPushDeliveryResultSchema.parse(value)
	);
	if (!result.updated) return "lease-lost" as const;
	return result.state === "dead" ? ("dead" as const) : ("retry" as const);
}

async function callRpc<T>(
	supabase: AppSupabaseClient,
	name: keyof Database["public"]["Functions"],
	parameters: Record<string, unknown>,
	parse: (value: unknown) => T
) {
	const { data, error } = await supabase.rpc(name, parameters as never);
	if (error) {
		throw new PushDispatcherError(`Web Push ${name} RPC failed.`, error);
	}
	try {
		return parse(data);
	} catch (error) {
		throw new PushDispatcherError(`Web Push ${name} RPC returned an invalid response.`, error);
	}
}

async function deliverOne(
	supabase: AppSupabaseClient,
	delivery: ClaimedPushDelivery,
	sendNotification: SendNotification
) {
	const payload: WebPushPayload = webPushPayloadSchema.parse({
		v: 1,
		type: "new-items",
		runId: delivery.run_id,
		source: delivery.source,
		insertedCount: delivery.inserted_count,
		badgeCount: delivery.badge_count,
		url: "/main",
	});

	try {
		await sendNotification(
			{
				endpoint: delivery.endpoint,
				keys: {
					p256dh: delivery.p256dh,
					auth: delivery.auth,
				},
			},
			JSON.stringify(payload),
			{ TTL: 86_400, urgency: "normal", timeout: PUSH_REQUEST_TIMEOUT_MS }
		);

		const completed = await callRpc(
			supabase,
			"complete_web_push_delivery",
			{
				p_delivery_id: delivery.delivery_id,
				p_lease_token: delivery.delivery_lease_token,
			},
			(value) => {
				if (typeof value !== "boolean") throw new Error("Expected boolean.");
				return value;
			}
		);
		return completed ? ("delivered" as const) : ("lease-lost" as const);
	} catch (error) {
		if (error instanceof PushDispatcherError) throw error;
		return handleDeliveryFailure(supabase, delivery, safeErrorCode(error));
	}
}

type DeliveryOutcome = Awaited<ReturnType<typeof deliverOne>>;

function recordDeliveryOutcome(
	result: PushDispatchResult,
	deliveryStates: Array<{ deliveryId: number; state: string }>,
	deliveryId: number,
	outcome: DeliveryOutcome
) {
	if (typeof outcome === "string") {
		deliveryStates.push({ deliveryId, state: outcome });
		if (outcome === "delivered") result.deliveredCount += 1;
		if (outcome === "retry") result.retryCount += 1;
		if (outcome === "dead") result.deadCount += 1;
		return;
	}

	deliveryStates.push({ deliveryId, state: outcome.state });
	if (outcome.state === "invalidated") {
		result.invalidatedCount += 1;
		result.skippedCount += outcome.skippedCount;
	}
}

async function consumeDeliveryQueue(
	supabase: AppSupabaseClient,
	queue: ClaimedPushDelivery[],
	sendNotification: SendNotification,
	result: PushDispatchResult,
	deliveryStates: Array<{ deliveryId: number; state: string }>
) {
	while (queue.length > 0) {
		const delivery = queue.shift();
		if (!delivery) return;
		const outcome = await deliverOne(supabase, delivery, sendNotification);
		recordDeliveryOutcome(result, deliveryStates, delivery.delivery_id, outcome);
	}
}

export async function runWebPushDispatcher(
	supabase: AppSupabaseClient,
	configuration: Extract<WebPushServerConfiguration, { enabled: true }>,
	limit: number,
	dependencies: DispatcherDependencies = {}
): Promise<PushDispatchResult> {
	webPush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
	const sendNotification = dependencies.sendNotification ?? webPush.sendNotification;
	const deliveries = await callRpc(
		supabase,
		"claim_web_push_deliveries",
		{ p_limit: limit, p_lease_seconds: 120 },
		(value) => claimedPushDeliveriesSchema.parse(value)
	);

	const result = {
		claimedCount: deliveries.length,
		deliveredCount: 0,
		retryCount: 0,
		invalidatedCount: 0,
		deadCount: 0,
		skippedCount: 0,
	};
	const deliveryStates: Array<{ deliveryId: number; state: string }> = [];
	const queue = [...deliveries];
	const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, deliveries.length) }, () =>
		consumeDeliveryQueue(supabase, queue, sendNotification, result, deliveryStates)
	);
	await Promise.all(workers);

	console.info("[push-dispatch] completed", {
		...result,
		deliveries: deliveryStates.sort((a, b) => a.deliveryId - b.deliveryId),
	});
	return pushDispatchResultSchema.parse(result);
}
