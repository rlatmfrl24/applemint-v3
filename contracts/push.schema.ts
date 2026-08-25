import { z } from "zod";
import { crawlSourceSchema } from "./crawl-source.schema";

const pushConfigurationReasonSchema = z.enum(["disabled", "configuration-missing"]);
const postgresTimestampSchema = z.string().datetime({ offset: true });

export const pushConfigurationSchema = z
	.object({
		enabled: z.boolean(),
		publicKey: z.string().min(80).max(120).nullable(),
		reason: pushConfigurationReasonSchema.nullable(),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.enabled && (!value.publicKey || value.reason !== null)) {
			context.addIssue({
				code: "custom",
				message: "활성화된 Web Push 설정에는 public key가 필요합니다.",
			});
		}
		if (!value.enabled && (value.publicKey !== null || value.reason === null)) {
			context.addIssue({
				code: "custom",
				message: "비활성화된 Web Push 설정에는 중단 사유가 필요합니다.",
			});
		}
	});

const pushKeysSchema = z
	.object({
		p256dh: z
			.string()
			.min(32)
			.max(512)
			.regex(/^[A-Za-z0-9_-]+$/),
		auth: z
			.string()
			.min(8)
			.max(128)
			.regex(/^[A-Za-z0-9_-]+$/),
	})
	.strict();

export const pushSubscriptionInputSchema = z
	.object({
		endpoint: z.string().url().startsWith("https://").max(4096),
		expirationTime: z.number().int().nonnegative().nullable(),
		keys: pushKeysSchema,
	})
	.strict();

export const pushEndpointInputSchema = z
	.object({
		endpoint: z.string().url().startsWith("https://").max(4096),
	})
	.strict();

export const pushSubscribeResultSchema = z.object({ active: z.literal(true) }).strict();
export const pushUnsubscribeResultSchema = z.object({ disabled: z.boolean() }).strict();
export const pushSubscriptionStatusSchema = z.object({ active: z.boolean() }).strict();
export const pushAcknowledgeResultSchema = z
	.object({
		acknowledged: z.boolean(),
		acknowledgedAt: postgresTimestampSchema.nullable(),
	})
	.strict();

const webPushNewItemsPayloadSchema = z
	.object({
		v: z.literal(1),
		type: z.literal("new-items"),
		runId: z.string().regex(/^[1-9]\d*$/),
		source: crawlSourceSchema,
		insertedCount: z.number().int().positive(),
		badgeCount: z.number().int().positive(),
		url: z.literal("/main"),
	})
	.strict();

export const webPushTestPayloadSchema = z
	.object({
		v: z.literal(1),
		type: z.literal("test"),
		url: z.literal("/main/setting/app"),
	})
	.strict();

export const webPushPayloadSchema = z.discriminatedUnion("type", [
	webPushNewItemsPayloadSchema,
	webPushTestPayloadSchema,
]);

export const pushSendTestResultSchema = z
	.object({
		sent: z.literal(true),
		sentAt: z.string().datetime({ offset: true }),
	})
	.strict();

const claimedPushTestSubscriptionSchema = z
	.object({
		status: z.literal("claimed"),
		subscriptionId: z.coerce.number().int().positive(),
		endpoint: z.string().url().startsWith("https://").max(4096),
		p256dh: z.string().min(32).max(512),
		auth: z.string().min(8).max(128),
	})
	.strict();

export const pushTestClaimResultSchema = z.discriminatedUnion("status", [
	claimedPushTestSubscriptionSchema,
	z.object({ status: z.literal("not-found") }).strict(),
	z.object({ status: z.literal("inactive") }).strict(),
	z.object({ status: z.literal("expired") }).strict(),
	z
		.object({
			status: z.literal("cooldown"),
			retryAfterSeconds: z.coerce.number().int().positive().max(600),
		})
		.strict(),
]);

export const pushDispatchRequestSchema = z
	.object({
		limit: z.number().int().min(1).max(20).default(20),
	})
	.strict();

export const pushDispatchResultSchema = z
	.object({
		claimedCount: z.number().int().nonnegative(),
		deliveredCount: z.number().int().nonnegative(),
		retryCount: z.number().int().nonnegative(),
		invalidatedCount: z.number().int().nonnegative(),
		deadCount: z.number().int().nonnegative(),
		skippedCount: z.number().int().nonnegative(),
	})
	.strict();

export const pushDispatchResponseSchema = z.union([
	pushDispatchResultSchema,
	z
		.object({
			error: z.string(),
			reason: z.enum(["disabled", "configuration-missing", "invalid-secret"]).optional(),
		})
		.strict(),
]);

const claimedPushDeliverySchema = z
	.object({
		delivery_id: z.coerce.number().int().positive(),
		delivery_lease_token: z.string().uuid(),
		subscription_id: z.coerce.number().int().positive(),
		endpoint: z.string().url().startsWith("https://").max(4096),
		p256dh: z.string().min(32).max(512),
		auth: z.string().min(8).max(128),
		expiration_time: postgresTimestampSchema.nullable(),
		run_id: z.string().regex(/^[1-9]\d*$/),
		source: crawlSourceSchema,
		inserted_count: z.coerce.number().int().positive(),
		badge_count: z.coerce.number().int().positive(),
		created_at: postgresTimestampSchema,
	})
	.strict();

export const claimedPushDeliveriesSchema = z.array(claimedPushDeliverySchema).max(20);

export const retryPushDeliveryResultSchema = z
	.object({
		updated: z.boolean(),
		state: z.enum(["retry", "dead"]).optional(),
		availableAt: postgresTimestampSchema.nullable().optional(),
	})
	.strict();

export const invalidatePushSubscriptionResultSchema = z
	.object({
		invalidated: z.boolean(),
		skippedCount: z.number().int().nonnegative(),
	})
	.strict();

export type PushConfiguration = z.infer<typeof pushConfigurationSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
export type WebPushPayload = z.infer<typeof webPushPayloadSchema>;
export type WebPushTestPayload = z.infer<typeof webPushTestPayloadSchema>;
export type PushTestClaimResult = z.infer<typeof pushTestClaimResultSchema>;
export type ClaimedPushDelivery = z.infer<typeof claimedPushDeliverySchema>;
export type PushDispatchResult = z.infer<typeof pushDispatchResultSchema>;
