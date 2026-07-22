import { beforeEach, describe, expect, it, vi } from "vitest";

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
	userId = "owner",
	isOwner = true,
	policyData = settings,
	policyError = null,
}: {
	userId?: string | null;
	isOwner?: boolean;
	policyData?: unknown;
	policyError?: { message: string } | null;
} = {}) {
	const rpc = vi
		.fn()
		.mockResolvedValueOnce({ data: isOwner, error: null })
		.mockResolvedValueOnce({ data: policyData, error: policyError });
	createClientMock.mockResolvedValue({
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: userId ? { id: userId } : null },
				error: null,
			}),
		},
		rpc,
	});
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

	it("미로그인과 비소유자 접근을 차단한다", async () => {
		mockRpc({ userId: null });
		expect((await GET()).status).toBe(401);

		mockRpc({ isOwner: false });
		expect((await GET()).status).toBe(403);
	});

	it("RPC 오류와 손상된 정책 응답을 500으로 닫는다", async () => {
		mockRpc({ policyError: { message: "db unavailable" } });
		expect((await GET()).status).toBe(500);

		mockRpc({ policyData: { ...settings, sources: [] } });
		expect((await GET()).status).toBe(500);
	});
});
