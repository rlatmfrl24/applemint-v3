import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { GET as getQuickSave } from "../quick-save/route";
import { GET as getTrash } from "../trash/route";
import { GET as getThreads } from "./route";
import { GET as getStats } from "./stats/route";

function mockAccess({
	userId = "owner",
	isOwner = true,
	ownerError = null,
}: {
	userId?: string | null;
	isOwner?: boolean;
	ownerError?: Error | null;
} = {}) {
	createClientMock.mockResolvedValue({
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: userId ? { id: userId } : null },
				error: null,
			}),
		},
		rpc: vi.fn().mockResolvedValue({ data: isOwner, error: ownerError }),
	});
}

function request(path: string) {
	return new Request(`http://localhost${path}`) as NextRequest;
}

describe.each([
	["신규 스레드", (req: NextRequest) => getThreads(req), "/api/new-threads"],
	["퀵 세이브", (req: NextRequest) => getQuickSave(req), "/api/quick-save"],
	["휴지통", (req: NextRequest) => getTrash(req), "/api/trash"],
	["신규 스레드 통계", (req: NextRequest) => getStats(req), "/api/new-threads/stats"],
])("%s API 소유자 검사", (_name, handler, path) => {
	beforeEach(() => {
		createClientMock.mockReset();
	});

	it("미로그인 요청에 401을 반환한다", async () => {
		mockAccess({ userId: null });

		const response = await handler(request(path));

		expect(response.status).toBe(401);
	});

	it("비소유자 요청에 403을 반환한다", async () => {
		mockAccess({ isOwner: false });

		const response = await handler(request(path));

		expect(response.status).toBe(403);
	});

	it("소유자 RPC 오류에 503을 반환한다", async () => {
		mockAccess({ ownerError: new Error("rpc unavailable") });

		const response = await handler(request(path));

		expect(response.status).toBe(503);
	});
});

describe("신규 스레드 통계 응답", () => {
	beforeEach(() => {
		createClientMock.mockReset();
	});

	function mockStatsRpc(statsResult: { data: unknown; error: { message: string } | null }) {
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({ data: true, error: null })
			.mockResolvedValueOnce(statsResult);
		createClientMock.mockResolvedValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } }, error: null }),
			},
			rpc,
		});
		return rpc;
	}

	it("필터를 RPC로 전달하고 숫자로 정규화한 통계를 반환한다", async () => {
		const rpc = mockStatsRpc({
			data: [{ key: "normal", label: "normal", count: "2", total_count: "2" }],
			error: null,
		});

		const response = await getStats(request("/api/new-threads/stats?filterType=normal"));

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

	it("통계 RPC 오류를 500으로 반환한다", async () => {
		mockStatsRpc({ data: null, error: { message: "stats unavailable" } });

		const response = await getStats(request("/api/new-threads/stats"));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "stats unavailable" });
	});
});
