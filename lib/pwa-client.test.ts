import { describe, expect, it, vi } from "vitest";
import {
	acknowledgeCurrentInboxBadge,
	activatePushNotifications,
	deactivatePushNotifications,
	subscriptionToInput,
} from "./pwa-client";

function createSubscription(endpoint = "https://push.test/device") {
	return {
		endpoint,
		toJSON: () => ({
			endpoint,
			expirationTime: null,
			keys: { p256dh: "A".repeat(43), auth: "B".repeat(22) },
		}),
		unsubscribe: vi.fn().mockResolvedValue(true),
	} as unknown as PushSubscription;
}

describe("PWA Push client", () => {
	it("표준 PushSubscriptionJSON을 공개 입력 계약으로 변환한다", () => {
		expect(subscriptionToInput(createSubscription())).toEqual({
			endpoint: "https://push.test/device",
			expirationTime: null,
			keys: { p256dh: "A".repeat(43), auth: "B".repeat(22) },
		});
	});

	it("사용자 동작에서만 권한을 요청하고 허용된 경우 구독을 저장한다", async () => {
		const subscription = createSubscription();
		const save = vi.fn().mockResolvedValue({ active: true });
		const browser = {
			getPermission: () => "default" as const,
			requestPermission: vi.fn().mockResolvedValue("granted" as const),
			getSubscription: vi.fn().mockResolvedValue(null),
			createSubscription: vi.fn().mockResolvedValue(subscription),
		};

		await expect(activatePushNotifications("public-key", save, { browser })).resolves.toMatchObject(
			{
				permission: "granted",
				subscription,
			}
		);
		expect(browser.requestPermission).toHaveBeenCalledOnce();
		expect(save).toHaveBeenCalledOnce();
	});

	it("서버 저장 실패 시 이번에 만든 브라우저 구독을 rollback한다", async () => {
		const subscription = createSubscription();
		const browser = {
			getPermission: () => "granted" as const,
			requestPermission: vi.fn(),
			getSubscription: vi.fn().mockResolvedValue(null),
			createSubscription: vi.fn().mockResolvedValue(subscription),
		};

		await expect(
			activatePushNotifications(
				"public-key",
				() => Promise.reject(new Error("server unavailable")),
				{ browser }
			)
		).rejects.toThrow("server unavailable");
		expect(subscription.unsubscribe).toHaveBeenCalledOnce();
	});

	it("거부된 권한을 자동 재요청하거나 구독하지 않는다", async () => {
		const browser = {
			getPermission: () => "denied" as const,
			requestPermission: vi.fn(),
			getSubscription: vi.fn(),
			createSubscription: vi.fn(),
		};
		const save = vi.fn();

		await expect(activatePushNotifications("public-key", save, { browser })).resolves.toEqual({
			permission: "denied",
			subscription: null,
		});
		expect(browser.requestPermission).not.toHaveBeenCalled();
		expect(browser.createSubscription).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
	});

	it("서버에서 비활성화된 기존 구독은 브라우저에서 제거한 뒤 새 구독으로 교체한다", async () => {
		const existing = createSubscription("https://push.test/stale");
		const replacement = createSubscription("https://push.test/replacement");
		const save = vi.fn().mockResolvedValue({ active: true });
		const browser = {
			getPermission: () => "granted" as const,
			requestPermission: vi.fn(),
			getSubscription: vi.fn().mockResolvedValue(existing),
			createSubscription: vi.fn().mockResolvedValue(replacement),
		};

		await expect(
			activatePushNotifications("public-key", save, {
				browser,
				replaceExisting: true,
			})
		).resolves.toMatchObject({ subscription: replacement });

		expect(existing.unsubscribe).toHaveBeenCalledOnce();
		expect(browser.createSubscription).toHaveBeenCalledOnce();
		expect(save).toHaveBeenCalledWith(subscriptionToInput(replacement));
	});

	it("비활성화는 서버 중단 후 브라우저 구독과 badge를 순서대로 해제한다", async () => {
		const subscription = createSubscription();
		const order: string[] = [];
		const disable = vi.fn(async () => {
			order.push("server");
		});
		vi.mocked(subscription.unsubscribe).mockImplementation(async () => {
			order.push("browser");
			return true;
		});
		const clear = vi.fn(async () => {
			order.push("badge");
		});

		await deactivatePushNotifications(subscription, disable, clear);

		expect(order).toEqual(["server", "browser", "badge"]);
	});

	it("브라우저 구독 해제가 false이면 badge를 지우거나 성공 처리하지 않는다", async () => {
		const subscription = createSubscription();
		vi.mocked(subscription.unsubscribe).mockResolvedValue(false);
		const disable = vi.fn().mockResolvedValue({ disabled: true });
		const clear = vi.fn().mockResolvedValue(undefined);

		await expect(deactivatePushNotifications(subscription, disable, clear)).rejects.toThrow(
			"브라우저 알림 구독을 해제하지 못했습니다."
		);
		expect(disable).toHaveBeenCalledOnce();
		expect(clear).not.toHaveBeenCalled();
	});

	it("Inbox acknowledge 성공 후에만 badge를 초기화한다", async () => {
		const subscription = createSubscription();
		const clearBadge = vi.fn().mockResolvedValue(undefined);
		const browser = {
			getSubscription: vi.fn().mockResolvedValue(subscription),
			clearBadge,
		};

		await expect(
			acknowledgeCurrentInboxBadge(() => Promise.resolve({ acknowledged: false }), browser)
		).resolves.toBe(false);
		expect(clearBadge).not.toHaveBeenCalled();

		await expect(
			acknowledgeCurrentInboxBadge(() => Promise.resolve({ acknowledged: true }), browser)
		).resolves.toBe(true);
		expect(clearBadge).toHaveBeenCalledOnce();
	});
});
