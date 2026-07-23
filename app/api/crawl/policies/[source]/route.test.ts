import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnerClientMock } from "@/test/support/supabase";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { PATCH } from "./route";

const settings = {
	schedulerEnabled: true,
	serverNow: "2026-07-22T12:00:00.000Z",
	dispatcherIntervalSeconds: 300,
	sources: ["arcalive", "battlepage", "insagirl"].map((source) => ({
		source,
		scheduleEnabled: true,
		cooldownSeconds: source === "battlepage" ? 14400 : source === "arcalive" ? 7200 : 10800,
		recommendedCooldownSeconds:
			source === "battlepage" ? 14400 : source === "arcalive" ? 7200 : 10800,
		runBudgetSeconds: 45,
		updatedAt: "2026-07-22T12:00:00.000Z",
		lastFinishedAt: null,
		nextEligibleAt: "2026-07-22T12:00:00.000Z",
		nextScheduledAt: "2026-07-22T12:05:00.000Z",
		activeRunId: null,
		latest: null,
	})),
};

function request(body: unknown) {
	return new Request("http://localhost/api/crawl/policies/arcalive", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	}) as NextRequest;
}

function context(source = "arcalive") {
	return { params: Promise.resolve({ source }) };
}

function mockRpc({
	updateData = { updated: true, reason: null, settings },
	updateError = null,
}: {
	updateData?: unknown;
	updateError?: { code?: string; message: string } | null;
} = {}) {
	const { client, rpc } = createOwnerClientMock({
		rpcResults: [{ data: updateData, error: updateError }],
	});
	createClientMock.mockResolvedValue(client);
	return rpc;
}

const validBody = {
	scheduleEnabled: false,
	cooldownSeconds: 3600,
	expectedUpdatedAt: "2026-07-22T11:00:00.000Z",
};

describe("PATCH /api/crawl/policies/[source]", () => {
	beforeEach(() => createClientMock.mockReset());

	it("검증된 정책을 compare-and-swap RPC에 전달한다", async () => {
		const rpc = mockRpc();
		const response = await PATCH(request(validBody), context());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(settings);
		expect(rpc).toHaveBeenNthCalledWith(2, "update_crawl_source_policy", {
			p_source: "arcalive",
			p_schedule_enabled: false,
			p_cooldown_seconds: 3600,
			p_expected_updated_at: "2026-07-22T11:00:00.000Z",
		});
	});

	it("지원하지 않는 소스와 잘못된 주기를 400으로 거부한다", async () => {
		expect((await PATCH(request(validBody), context("issuelink"))).status).toBe(400);
		expect((await PATCH(request({ ...validBody, cooldownSeconds: 3599 }), context())).status).toBe(
			400
		);
		expect((await PATCH(request({ ...validBody, unexpected: true }), context())).status).toBe(400);
	});

	it("동시 수정 충돌에 최신 정책을 포함한 409를 반환한다", async () => {
		mockRpc({ updateData: { updated: false, reason: "conflict", settings } });
		const response = await PATCH(request(validBody), context());

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ settings });
	});

	it("DB 검증 오류와 손상된 결과를 안전하게 변환한다", async () => {
		mockRpc({ updateError: { code: "22023", message: "invalid cooldown" } });
		expect((await PATCH(request(validBody), context())).status).toBe(400);

		mockRpc({ updateData: { updated: true, settings: null } });
		expect((await PATCH(request(validBody), context())).status).toBe(500);
	});
});
