import { describe, expect, it, vi } from "vitest";
import { RequestMetrics } from "@/server/observability/request-metrics";
import type { AppSupabaseClient } from "@/types/supabase";
import { PushRepository } from "./push.repository";

const subscription = {
	endpoint: "https://push.test/device",
	expirationTime: 1_786_000_000_000,
	keys: { p256dh: "A".repeat(43), auth: "B".repeat(22) },
};

describe("PushRepository", () => {
	it("구독 RPC 성공 응답을 검증하고 metrics를 기록한다", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: { active: true }, error: null });
		const metrics = new RequestMetrics();
		const repository = new PushRepository({ rpc } as unknown as AppSupabaseClient, metrics);

		await expect(repository.subscribe(subscription)).resolves.toEqual({ active: true });
		expect(rpc).toHaveBeenCalledWith("upsert_web_push_subscription", {
			p_endpoint: subscription.endpoint,
			p_p256dh: subscription.keys.p256dh,
			p_auth: subscription.keys.auth,
			p_expiration_time: new Date(subscription.expirationTime).toISOString(),
		});
		expect(metrics.snapshot()).toMatchObject({
			repositoryCallCount: 1,
			downstreamCallCount: 1,
			repositoryCalls: [{ operation: "push.subscribe", callCount: 1 }],
		});
	});

	it("구독 상태 RPC 오류를 domain error로 변환한다", async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: null,
			error: { code: "42501", message: "forbidden", details: "", hint: "" },
		});
		const repository = new PushRepository({ rpc } as unknown as AppSupabaseClient);

		await expect(repository.status(subscription.endpoint)).rejects.toMatchObject({
			code: "Forbidden",
		});
	});

	it("손상된 구독 중단 응답을 fail closed 한다", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: { disabled: "yes" }, error: null });
		const repository = new PushRepository({ rpc } as unknown as AppSupabaseClient);

		await expect(repository.unsubscribe(subscription.endpoint)).rejects.toMatchObject({
			code: "UnexpectedFailure",
		});
	});

	it("Inbox acknowledge의 nullable timestamp 계약을 보존한다", async () => {
		const response = { acknowledged: false, acknowledgedAt: null };
		const rpc = vi.fn().mockResolvedValue({ data: response, error: null });
		const repository = new PushRepository({ rpc } as unknown as AppSupabaseClient);

		await expect(repository.acknowledgeInbox(subscription.endpoint)).resolves.toEqual(response);
		expect(rpc).toHaveBeenCalledWith("acknowledge_web_push_inbox", {
			p_endpoint: subscription.endpoint,
		});
	});
});
