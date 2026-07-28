import { describe, expect, it } from "vitest";
import {
	pushConfigurationSchema,
	pushSubscriptionInputSchema,
	webPushPayloadSchema,
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
