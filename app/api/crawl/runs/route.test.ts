import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());

const alertsDashboard = {
	alerts: [],
	alertSettings: {
		parserFailureStreak: 2,
		parserDropRatio: 0.5,
		parserDropStreak: 2,
		noSuccessSeconds: 172800,
		transportWindow: 3,
		transportErrorRatio: 0.5,
		transportMinFailures: 2,
		cooldownSeconds: 86400,
		lastEvaluatedAt: null,
	},
};

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { GET } from "./route";

function request(query = "") {
	return new Request(`http://localhost/api/crawl/runs${query}`) as NextRequest;
}

function mockRpc({
	userId = "owner",
	isOwner = true,
	ownerError = null,
	dashboard = { activeRun: null, sources: [], runs: [] },
	dashboardError = null,
	alerts = alertsDashboard,
	alertError = null,
}: {
	userId?: string | null;
	isOwner?: boolean;
	ownerError?: Error | null;
	dashboard?: unknown;
	dashboardError?: { message: string } | null;
	alerts?: unknown;
	alertError?: { message: string } | null;
} = {}) {
	const rpc = vi
		.fn()
		.mockResolvedValueOnce({ data: isOwner, error: ownerError })
		.mockResolvedValueOnce({ data: dashboard, error: dashboardError })
		.mockResolvedValueOnce({ data: alerts, error: alertError });
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

describe("GET /api/crawl/runs", () => {
	beforeEach(() => {
		createClientMock.mockReset();
	});

	it.each([
		[null, true, null, 401],
		["user", false, null, 403],
		["user", true, new Error("unavailable"), 503],
	] as const)("소유자 검사 결과를 상태 코드로 반환한다", async (userId, isOwner, ownerError, status) => {
		mockRpc({ userId, isOwner, ownerError });
		const response = await GET(request());
		expect(response.status).toBe(status);
	});

	it("잘못된 limit을 400으로 거부한다", async () => {
		mockRpc();
		const response = await GET(request("?limit=0&trendLimit=51"));
		expect(response.status).toBe(400);
	});

	it("검증한 limit과 trendLimit을 RPC에 전달한다", async () => {
		const rpc = mockRpc();
		const response = await GET(request("?limit=12&trendLimit=8"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			activeRun: null,
			sources: [],
			runs: [],
			...alertsDashboard,
		});
		expect(rpc).toHaveBeenNthCalledWith(2, "get_crawl_runs_dashboard", {
			p_limit: 12,
			p_trend_limit: 8,
		});
		expect(rpc).toHaveBeenNthCalledWith(3, "get_crawl_alerts_dashboard");
	});

	it("dashboard RPC 오류와 손상된 응답을 500으로 반환한다", async () => {
		mockRpc({ dashboardError: { message: "db unavailable" } });
		expect((await GET(request())).status).toBe(500);

		mockRpc({ dashboard: null });
		expect((await GET(request())).status).toBe(500);

		mockRpc({ dashboard: { activeRun: null, sources: null, runs: [] } });
		expect((await GET(request())).status).toBe(500);

		mockRpc({ alertError: { message: "alerts unavailable" } });
		expect((await GET(request())).status).toBe(500);

		mockRpc({ alerts: null });
		expect((await GET(request())).status).toBe(500);
	});
});
