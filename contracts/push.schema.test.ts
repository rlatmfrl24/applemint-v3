import { describe, expect, it } from "vitest";
import {
	claimedPushDeliveriesSchema,
	pushAcknowledgeResultSchema,
	pushConfigurationSchema,
	pushSendTestResultSchema,
	pushSubscriptionInputSchema,
	pushTestClaimResultSchema,
	retryPushDeliveryResultSchema,
	webPushPayloadSchema,
	webPushTestPayloadSchema,
} from "./push.schema";

describe("Web Push contracts", () => {
	it("알림 payload는 버전·source·개수·고정 URL만 허용한다", () => {
		const payload = {
			v: 1,
			type: "new-items",
			runId: "9007199254740993",
			source: "battlepage",
			insertedCount: 12,
			badgeCount: 20,
			url: "/main",
		};
		expect(webPushPayloadSchema.parse(payload)).toEqual(payload);
		expect(webPushPayloadSchema.safeParse({ ...payload, title: "private title" }).success).toBe(
			false
		);
		expect(webPushPayloadSchema.safeParse({ ...payload, v: 2 }).success).toBe(false);
		expect(webPushPayloadSchema.safeParse({ ...payload, badgeCount: 0 }).success).toBe(false);
		expect(webPushPayloadSchema.safeParse({ ...payload, source: "issuelink" }).success).toBe(true);
		expect(webPushPayloadSchema.safeParse({ ...payload, source: "dogdrip" }).success).toBe(true);
	});

	it("테스트 payload는 설정 URL 외 필드와 URL을 허용하지 않는다", () => {
		const payload = { v: 1, type: "test", url: "/main/setting/app" } as const;
		expect(webPushTestPayloadSchema.parse(payload)).toEqual(payload);
		expect(webPushPayloadSchema.parse(payload)).toEqual(payload);
		expect(webPushPayloadSchema.safeParse({ ...payload, badgeCount: 1 }).success).toBe(false);
		expect(webPushPayloadSchema.safeParse({ ...payload, url: "/main" }).success).toBe(false);
	});

	it("테스트 claim 비밀값은 claimed 상태에서만 서버 내부 계약으로 허용한다", () => {
		expect(
			pushTestClaimResultSchema.parse({
				status: "claimed",
				subscriptionId: 1,
				endpoint: "https://push.test/device",
				p256dh: "A".repeat(43),
				auth: "B".repeat(22),
			})
		).toMatchObject({ status: "claimed", subscriptionId: 1 });
		expect(pushTestClaimResultSchema.parse({ status: "cooldown", retryAfterSeconds: 60 })).toEqual({
			status: "cooldown",
			retryAfterSeconds: 60,
		});
		expect(
			pushSendTestResultSchema.parse({
				sent: true,
				sentAt: "2026-07-30T00:00:00.000Z",
			})
		).toEqual({ sent: true, sentAt: "2026-07-30T00:00:00.000Z" });
	});

	it("PushSubscriptionJSON의 endpoint와 암호화 키를 strict하게 검증한다", () => {
		const subscription = {
			endpoint: "https://push.test/device",
			expirationTime: null,
			keys: {
				p256dh: "A".repeat(43),
				auth: "B".repeat(22),
			},
		};
		expect(pushSubscriptionInputSchema.parse(subscription)).toEqual(subscription);
		expect(
			pushSubscriptionInputSchema.safeParse({ ...subscription, endpoint: "http://push.test" })
				.success
		).toBe(false);
		expect(
			pushSubscriptionInputSchema.safeParse({ ...subscription, extra: "not-allowed" }).success
		).toBe(false);
	});

	it("활성 설정에만 VAPID public key를 노출한다", () => {
		expect(
			pushConfigurationSchema.parse({
				enabled: true,
				publicKey: "A".repeat(87),
				reason: null,
			})
		).toBeTruthy();
		expect(
			pushConfigurationSchema.safeParse({
				enabled: false,
				publicKey: "A".repeat(87),
				reason: "disabled",
			}).success
		).toBe(false);
	});
});

describe("Web Push PostgreSQL timestamp contracts", () => {
	it("PostgREST가 반환하는 +00:00 offset timestamp를 허용한다", () => {
		const timestamp = "2026-07-28T04:55:03.263668+00:00";

		expect(
			pushAcknowledgeResultSchema.parse({
				acknowledged: true,
				acknowledgedAt: timestamp,
			})
		).toEqual({ acknowledged: true, acknowledgedAt: timestamp });
		expect(
			retryPushDeliveryResultSchema.parse({
				updated: true,
				state: "retry",
				availableAt: timestamp,
			})
		).toMatchObject({ availableAt: timestamp });
		expect(
			claimedPushDeliveriesSchema.parse([
				{
					delivery_id: 1,
					delivery_lease_token: "00000000-0000-4000-8000-000000000001",
					subscription_id: 1,
					endpoint: "https://push.test/device",
					p256dh: "A".repeat(43),
					auth: "B".repeat(22),
					expiration_time: timestamp,
					run_id: "1",
					source: "battlepage",
					inserted_count: 1,
					badge_count: 1,
					created_at: timestamp,
				},
			])
		).toHaveLength(1);
	});
});
