import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnerClientMock } from "@/test/support/supabase";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { GET as getThreads } from "./route";
import { GET as getStats } from "./stats/route";

function request(path: string) {
	return new Request(`http://localhost${path}`) as NextRequest;
}

describe.each([
	["스레드 목록", (req: NextRequest) => getThreads(req), "/api/threads?state=inbox"],
	["스레드 통계", (req: NextRequest) => getStats(req), "/api/threads/stats?state=inbox"],
])("%s API 소유자 검사", (_name, handler, path) => {
	beforeEach(() => {
		createClientMock.mockReset();
	});

	it("소유자 확인 오류를 fail-closed 503으로 반환한다", async () => {
		createClientMock.mockResolvedValue(
			createOwnerClientMock({ ownerError: new Error("rpc unavailable") }).client
		);

		const response = await handler(request(path));

		expect(response.status).toBe(503);
	});
});

describe("스레드 통계 응답", () => {
	beforeEach(() => {
		createClientMock.mockReset();
	});

	function mockStatsRpc(statsResult: { data: unknown; error: { message: string } | null }) {
		const { client, rpc } = createOwnerClientMock({ rpcResults: [statsResult] });
		createClientMock.mockResolvedValue(client);
		return rpc;
	}

	it("필터를 RPC로 전달하고 숫자로 정규화한 통계를 반환한다", async () => {
		const rpc = mockStatsRpc({
			data: [{ key: "normal", label: "normal", count: "2", total_count: "2" }],
			error: null,
		});

		const response = await getStats(request("/api/threads/stats?state=inbox&filterType=normal"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			totalCount: 2,
			counts: [{ key: "normal", label: "normal", count: 2 }],
		});
		expect(rpc).toHaveBeenLastCalledWith("get_thread_stats", {
			p_state: "inbox",
			p_filter_type: "normal",
		});
	});

	it("공급자 통계 key는 유지하고 표시 라벨만 정규화한다", async () => {
		mockStatsRpc({
			data: [
				{ key: "youtube", label: "youtube", count: "3", total_count: "5" },
				{ key: "imgur", label: "imgur", count: "2", total_count: "5" },
			],
			error: null,
		});

		const response = await getStats(request("/api/threads/stats?state=inbox"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			totalCount: 5,
			counts: [
				{ key: "youtube", label: "YouTube", count: 3 },
				{ key: "imgur", label: "Imgur", count: 2 },
			],
		});
	});

	it("통계 RPC 오류를 500으로 반환한다", async () => {
		mockStatsRpc({ data: null, error: { message: "stats unavailable" } });

		const response = await getStats(request("/api/threads/stats?state=inbox"));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "stats unavailable" });
	});
});
