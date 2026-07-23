import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnerClientMock } from "@/test/support/supabase";

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
	dashboard = {
		activeRun: null,
		activeRuns: [],
		runtimeSettings: { maxConcurrency: 2, lockTtlSeconds: 60, heartbeatIntervalSeconds: 15 },
		sources: [],
		runs: [],
	},
	dashboardError = null,
	alerts = alertsDashboard,
	alertError = null,
}: {
	dashboard?: unknown;
	dashboardError?: { message: string } | null;
	alerts?: unknown;
	alertError?: { message: string } | null;
} = {}) {
	const { client, rpc } = createOwnerClientMock({
		rpcResults: [
			{ data: dashboard, error: dashboardError },
			{ data: alerts, error: alertError },
		],
	});
	createClientMock.mockResolvedValue(client);
	return rpc;
}

describe("GET /api/crawl/runs", () => {
	beforeEach(() => {
		createClientMock.mockReset();
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
			activeRuns: [],
			runtimeSettings: {
				maxConcurrency: 2,
				lockTtlSeconds: 60,
				heartbeatIntervalSeconds: 15,
			},
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
