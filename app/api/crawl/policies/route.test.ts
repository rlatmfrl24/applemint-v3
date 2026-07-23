import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnerClientMock } from "@/test/support/supabase";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { GET } from "./route";

const settings = {
	schedulerEnabled: false,
	serverNow: "2026-07-22T12:00:00.000Z",
	dispatcherIntervalSeconds: 300,
	sources: ["arcalive", "battlepage", "insagirl"].map((source) => ({
		source,
		scheduleEnabled: true,
		cooldownSeconds: 10800,
		recommendedCooldownSeconds: 10800,
		runBudgetSeconds: 45,
		updatedAt: "2026-07-22T12:00:00.000Z",
		lastFinishedAt: null,
		nextEligibleAt: "2026-07-22T12:00:00.000Z",
		nextScheduledAt: null,
		activeRunId: null,
		latest: null,
	})),
};

function mockRpc({
	policyData = settings,
	policyError = null,
}: {
	policyData?: unknown;
	policyError?: { message: string } | null;
} = {}) {
	const { client, rpc } = createOwnerClientMock({
		rpcResults: [{ data: policyData, error: policyError }],
	});
	createClientMock.mockResolvedValue(client);
	return rpc;
}

describe("GET /api/crawl/policies", () => {
	beforeEach(() => createClientMock.mockReset());

	it("소유자에게 가벼운 수집 정책 응답을 반환한다", async () => {
		const rpc = mockRpc();
		const response = await GET();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(settings);
		expect(rpc).toHaveBeenNthCalledWith(2, "get_crawl_source_policy_settings");
	});

	it("RPC 오류와 손상된 정책 응답을 500으로 닫는다", async () => {
		mockRpc({ policyError: { message: "db unavailable" } });
		expect((await GET()).status).toBe(500);

		mockRpc({ policyData: { ...settings, sources: [] } });
		expect((await GET()).status).toBe(500);
	});
});
