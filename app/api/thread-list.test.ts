import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { GET as getNewThreads } from "./new-threads/route";
import { GET as getQuickSave } from "./quick-save/route";
import { decodeThreadCursor, encodeThreadCursor, parseThreadListParams } from "./thread-list";
import { GET as getTrash } from "./trash/route";

const createdAt = "2026-07-20T12:00:00.000Z";
const rows = [
	{
		id: 3,
		created_at: createdAt,
		type: "normal",
		url: "https://example.com/3",
		title: "three",
		description: null,
		host: "example.com",
		tag: null,
		captured_at: createdAt,
	},
	{
		id: 2,
		created_at: createdAt,
		type: "normal",
		url: "https://example.com/2",
		title: "two",
		description: null,
		host: "example.com",
		tag: null,
		captured_at: createdAt,
	},
	{
		id: 1,
		created_at: "2026-07-19T12:00:00.000Z",
		type: "normal",
		url: "https://example.com/1",
		title: "one",
		description: null,
		host: "example.com",
		tag: null,
		captured_at: createdAt,
	},
];

function request(path: string) {
	return new Request(`http://localhost${path}`) as NextRequest;
}

function mockOwner(rowsResult = rows) {
	rpcMock.mockImplementation((functionName: string) => {
		if (functionName === "is_applemint_owner") {
			return Promise.resolve({ data: true, error: null });
		}

		return Promise.resolve({ data: rowsResult, error: null });
	});
	createClientMock.mockResolvedValue({
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } }, error: null }),
		},
		rpc: rpcMock,
	});
}

describe("thread cursor", () => {
	it("created_at과 id를 Base64URL cursor로 왕복한다", () => {
		const encoded = encodeThreadCursor({ createdAt, id: "9007199254740993" });

		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeThreadCursor(encoded)).toEqual({
			createdAt,
			id: "9007199254740993",
		});
	});

	it("손상되거나 범위를 벗어난 cursor를 거부한다", () => {
		expect(() => decodeThreadCursor("broken")).toThrow("Invalid thread cursor.");
		expect(() => decodeThreadCursor(encodeThreadCursor({ createdAt: "invalid", id: "1" }))).toThrow(
			"Invalid thread cursor."
		);
		expect(() =>
			decodeThreadCursor(encodeThreadCursor({ createdAt, id: "9223372036854775808" }))
		).toThrow("Invalid thread cursor.");
	});

	it("limit 기본값과 최대값을 적용한다", () => {
		expect(parseThreadListParams(request("/api/new-threads")).limit).toBe(24);
		expect(parseThreadListParams(request("/api/new-threads?limit=1000")).limit).toBe(100);
	});
});

describe("thread list API", () => {
	beforeEach(() => {
		createClientMock.mockReset();
		rpcMock.mockReset();
	});

	it.each([
		["new-threads", getNewThreads],
		["quick-save", getQuickSave],
		["trash", getTrash],
	] as const)("%s 목록이 동일한 page 계약을 반환한다", async (table, handler) => {
		mockOwner();

		const response = await handler(request(`/api/${table}?limit=2`));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.items).toEqual(rows.slice(0, 2));
		expect(decodeThreadCursor(body.nextCursor)).toEqual({ createdAt, id: "2" });
		expect(rpcMock).toHaveBeenLastCalledWith("list_thread_page", {
			p_list: table,
			p_limit: 2,
			p_cursor_created_at: null,
			p_cursor_id: null,
			p_filter_type: null,
		});
	});

	it("cursor와 필터를 RPC 복합 경계값으로 전달한다", async () => {
		mockOwner([]);
		const cursor = encodeThreadCursor({ createdAt, id: "2" });

		const response = await getNewThreads(
			request(`/api/new-threads?cursor=${cursor}&filterType=normal`)
		);

		expect(response.status).toBe(200);
		expect(rpcMock).toHaveBeenLastCalledWith("list_thread_page", {
			p_list: "new-threads",
			p_limit: 24,
			p_cursor_created_at: createdAt,
			p_cursor_id: "2",
			p_filter_type: "normal",
		});
	});

	it("잘못된 cursor에 400을 반환하고 목록 RPC를 호출하지 않는다", async () => {
		mockOwner();

		const response = await getTrash(request("/api/trash?cursor=broken"));

		expect(response.status).toBe(400);
		expect(rpcMock).not.toHaveBeenCalledWith("list_thread_page", expect.anything());
	});

	it("목록 RPC 오류에 500을 반환한다", async () => {
		mockOwner();
		rpcMock.mockImplementation((functionName: string) => {
			if (functionName === "is_applemint_owner") {
				return Promise.resolve({ data: true, error: null });
			}

			return Promise.resolve({ data: null, error: new Error("database unavailable") });
		});

		const response = await getQuickSave(request("/api/quick-save"));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "database unavailable" });
	});
});
