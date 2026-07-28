import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebPushServerConfiguration } from "@/server/push/configuration";

const webPushMock = vi.hoisted(() => ({
	setVapidDetails: vi.fn(),
	sendNotification: vi.fn(),
}));

vi.mock("web-push", () => ({ default: webPushMock }));

import { runWebPushDispatcher } from "./dispatcher";

const configuration = {
	enabled: true,
	public: { enabled: true, publicKey: "public-key", reason: null },
	publicKey: "public-key",
	privateKey: "private-key",
	subject: "mailto:owner@applemint.test",
} as WebPushServerConfiguration & { enabled: true };

function delivery(id: number, overrides: Record<string, unknown> = {}) {
	return {
		delivery_id: id,
		delivery_lease_token: `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`,
		subscription_id: id,
		endpoint: `https://push.test/device-${id}`,
		p256dh: "A".repeat(43),
		auth: "B".repeat(22),
		expiration_time: null,
		run_id: String(100 + id),
		source: "battlepage",
		inserted_count: 12,
		badge_count: 20,
		created_at: "2026-07-28T00:00:00.000Z",
		...overrides,
	};
}

function createClient(claims: unknown[]) {
	const rpc = vi.fn(async (name: string) => {
		switch (name) {
			case "claim_web_push_deliveries":
				return { data: claims, error: null };
			case "complete_web_push_delivery":
				return { data: true, error: null };
			case "retry_web_push_delivery":
				return {
					data: {
						updated: true,
						state: "retry",
						availableAt: "2026-07-28T00:01:00.000Z",
					},
					error: null,
				};
			case "invalidate_web_push_subscription":
				return { data: { invalidated: true, skippedCount: 2 }, error: null };
			default:
				throw new Error(`Unexpected RPC: ${name}`);
		}
	});
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("Web Push dispatcher", () => {
	beforeEach(() => {
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		webPushMock.setVapidDetails.mockReset();
	});

	it("claim한 delivery에 개인정보 없는 버전 payload를 발송하고 완료한다", async () => {
		const { client, rpc } = createClient([delivery(1)]);
		const sendNotification = vi.fn().mockResolvedValue({
			statusCode: 201,
			headers: {},
			body: "",
		});

		await expect(
			runWebPushDispatcher(client, configuration, 20, {
				sendNotification: sendNotification as never,
			})
		).resolves.toEqual({
			claimedCount: 1,
			deliveredCount: 1,
			retryCount: 0,
			invalidatedCount: 0,
			deadCount: 0,
			skippedCount: 0,
		});

		const payload = JSON.parse(sendNotification.mock.calls[0][1]);
		expect(payload).toEqual({
			v: 1,
			type: "new-items",
			runId: "101",
			source: "battlepage",
			insertedCount: 12,
			badgeCount: 20,
			url: "/main",
		});
		expect(payload).not.toHaveProperty("title");
		expect(payload).not.toHaveProperty("endpoint");
		expect(rpc).toHaveBeenCalledWith("complete_web_push_delivery", {
			p_delivery_id: 1,
			p_lease_token: delivery(1).delivery_lease_token,
		});
	});

	it("네트워크·408·429·5xx 실패를 안전한 code로 재시도한다", async () => {
		for (const statusCode of [undefined, 408, 429, 503]) {
			const { client, rpc } = createClient([delivery(2)]);
			const sendNotification = vi
				.fn()
				.mockRejectedValue(
					statusCode === undefined ? new Error("socket includes private endpoint") : { statusCode }
				);

			const result = await runWebPushDispatcher(client, configuration, 20, {
				sendNotification: sendNotification as never,
			});

			expect(result.retryCount).toBe(1);
			expect(rpc).toHaveBeenCalledWith(
				"retry_web_push_delivery",
				expect.objectContaining({
					p_delivery_id: 2,
					p_error_code: statusCode === undefined ? "push-network" : `push-${statusCode}`,
				})
			);
		}
	});

	it("404·410은 해당 subscription을 비활성화하고 남은 delivery를 집계한다", async () => {
		for (const statusCode of [404, 410]) {
			const { client, rpc } = createClient([delivery(3)]);
			const result = await runWebPushDispatcher(client, configuration, 20, {
				sendNotification: vi.fn().mockRejectedValue({ statusCode }) as never,
			});

			expect(result).toMatchObject({ invalidatedCount: 1, skippedCount: 2 });
			expect(rpc).toHaveBeenCalledWith("invalidate_web_push_subscription", {
				p_delivery_id: 3,
				p_lease_token: delivery(3).delivery_lease_token,
				p_error_code: `push-${statusCode}`,
			});
		}
	});

	it("동시 발송 수를 최대 5개로 제한한다", async () => {
		const { client } = createClient(Array.from({ length: 8 }, (_, index) => delivery(index + 1)));
		let active = 0;
		let maximum = 0;
		const sendNotification = vi.fn(async () => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return { statusCode: 201, headers: {}, body: "" };
		});

		const result = await runWebPushDispatcher(client, configuration, 20, {
			sendNotification: sendNotification as never,
		});

		expect(result.deliveredCount).toBe(8);
		expect(maximum).toBe(5);
	});
});
