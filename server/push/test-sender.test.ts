import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/errors/domain-error";
import type { WebPushServerConfiguration } from "./configuration";
import { sendWebPushTest } from "./test-sender";

const configuration = {
	enabled: true,
	public: { enabled: true, publicKey: "public-key", reason: null },
	publicKey: "public-key",
	privateKey: "private-key",
	subject: "mailto:owner@example.com",
} satisfies Extract<WebPushServerConfiguration, { enabled: true }>;

const claim = {
	status: "claimed",
	subscriptionId: 7,
	endpoint: "https://push.test/device-secret",
	p256dh: "A".repeat(43),
	auth: "B".repeat(22),
};

function createClient(responses: Record<string, unknown>) {
	const rpc = vi.fn(async (name: string) => ({
		data: responses[name] ?? null,
		error: null,
	}));
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("Web Push test sender", () => {
	beforeEach(() => {
		vi.spyOn(console, "info").mockImplementation(() => undefined);
	});

	it("실제 테스트 payload를 TTL 60·high urgency·15초 timeout으로 발송한다", async () => {
		const log = vi.spyOn(console, "info");
		const { client, rpc } = createClient({
			claim_web_push_test_subscription: claim,
		});
		const sendNotification = vi.fn().mockResolvedValue(undefined);
		const setVapidDetails = vi.fn();

		const result = await sendWebPushTest("https://push.test/device-secret", configuration, {
			createClient: () => client,
			sendNotification,
			setVapidDetails,
			now: () => new Date("2026-07-30T00:00:00.000Z"),
		});

		expect(rpc).toHaveBeenCalledWith("claim_web_push_test_subscription", {
			p_endpoint: "https://push.test/device-secret",
			p_cooldown_seconds: 60,
		});
		expect(sendNotification).toHaveBeenCalledWith(
			{
				endpoint: claim.endpoint,
				keys: { p256dh: claim.p256dh, auth: claim.auth },
			},
			JSON.stringify({ v: 1, type: "test", url: "/main/setting/app" }),
			{ TTL: 60, urgency: "high", timeout: 15_000 }
		);
		expect(result).toEqual({ sent: true, sentAt: "2026-07-30T00:00:00.000Z" });
		expect(JSON.stringify(result)).not.toContain("device-secret");
		expect(JSON.stringify(result)).not.toContain(claim.p256dh);
		expect(JSON.stringify(log.mock.calls)).not.toContain("device-secret");
		expect(JSON.stringify(log.mock.calls)).not.toContain(claim.p256dh);
		expect(JSON.stringify(log.mock.calls)).not.toContain(claim.auth);
	});

	it("60초 cooldown을 retryAfterSeconds와 함께 반환한다", async () => {
		const { client } = createClient({
			claim_web_push_test_subscription: { status: "cooldown", retryAfterSeconds: 37 },
		});

		const error = await sendWebPushTest("https://push.test/device", configuration, {
			createClient: () => client,
			sendNotification: vi.fn(),
			setVapidDetails: vi.fn(),
		}).catch((caught) => caught);

		expect(error).toBeInstanceOf(DomainError);
		expect(error).toMatchObject({
			code: "CapacityExceeded",
			data: { retryAfterSeconds: 37, reasonCode: "push-test-cooldown" },
		});
	});

	it.each([404, 410] as const)(
		"%s 응답은 구독을 무효화하고 재연결을 요구한다",
		async (statusCode) => {
			const { client, rpc } = createClient({
				claim_web_push_test_subscription: claim,
				invalidate_web_push_test_subscription: { invalidated: true, skippedCount: 2 },
			});
			const error = await sendWebPushTest("https://push.test/device-secret", configuration, {
				createClient: () => client,
				sendNotification: vi.fn().mockRejectedValue({ statusCode }),
				setVapidDetails: vi.fn(),
			}).catch((caught) => caught);

			expect(rpc).toHaveBeenLastCalledWith("invalidate_web_push_test_subscription", {
				p_subscription_id: 7,
				p_error_code: `push-${statusCode}`,
			});
			expect(error).toMatchObject({
				code: "StateConflict",
				data: { reasonCode: "push-subscription-invalid" },
			});
		}
	);

	it.each([new Error("timeout"), { statusCode: 408 }, { statusCode: 429 }, { statusCode: 503 }])(
		"네트워크·일시 오류는 구독을 무효화하지 않는다",
		async (failure) => {
			const { client, rpc } = createClient({
				claim_web_push_test_subscription: claim,
			});
			const error = await sendWebPushTest("https://push.test/device-secret", configuration, {
				createClient: () => client,
				sendNotification: vi.fn().mockRejectedValue(failure),
				setVapidDetails: vi.fn(),
			}).catch((caught) => caught);

			expect(error).toMatchObject({ code: "UpstreamTimeout" });
			expect(rpc).toHaveBeenCalledOnce();
		}
	);
});
