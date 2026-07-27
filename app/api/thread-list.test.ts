import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));

import { decodeThreadCursor, encodeThreadCursor, parseThreadListParams } from "./thread-list";
import { GET as getThreads } from "./threads/route";

const stateChangedAt = "2026-07-20T12:00:00.000Z";
const rows = [
	{
		id: 3,
		created_at: "2026-07-18T12:00:00.000Z",
		type: "youtube",
		url: "https://www.youtube.com/watch?v=video",
		title: "three",
		description: null,
		host: "youtube.com",
		tag: null,
		state: "inbox",
		captured_at: "2026-07-18T12:00:00.000Z",
		state_changed_at: stateChangedAt,
		media_metadata: {
			provider: "youtube",
			external_id: "video",
			media_kind: "video",
			status: "ready",
			title: "공식 제목",
			channel_title: "공식 채널",
			thumbnail_url: "https://i.ytimg.com/vi/video/hqdefault.jpg",
			duration_seconds: 125,
			live_status: "none",
			media_count: null,
			preview_urls: [],
			last_error_code: null,
			fetched_at: "2026-07-20T11:00:00.000Z",
			updated_at: "2026-07-20T11:00:00.000Z",
		},
	},
	{
		id: 2,
		created_at: "2026-07-18T12:00:00.000Z",
		type: "normal",
		url: "https://example.com/2",
		title: "two",
		description: null,
		host: "example.com",
		tag: null,
		state: "inbox",
		captured_at: "2026-07-18T12:00:00.000Z",
		state_changed_at: stateChangedAt,
		media_metadata: null,
	},
	{
		id: 1,
		created_at: "2026-07-17T12:00:00.000Z",
		type: "normal",
		url: "https://example.com/1",
		title: "one",
		description: null,
		host: "example.com",
		tag: null,
		state: "inbox",
		captured_at: "2026-07-17T12:00:00.000Z",
		state_changed_at: "2026-07-19T12:00:00.000Z",
		media_metadata: null,
	},
];

const request = (path: string) => new Request(`http://localhost${path}`) as NextRequest;

function mockOwner(rowsResult = rows) {
	rpcMock.mockImplementation((functionName: string) => {
		if (functionName === "is_applemint_owner") return Promise.resolve({ data: true, error: null });
		return Promise.resolve({ data: rowsResult, error: null });
	});
	createClientMock.mockResolvedValue({
		auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } }, error: null }) },
		rpc: rpcMock,
	});
}

describe("thread cursor", () => {
	it("버전과 상태를 포함한 Base64URL cursor를 왕복한다", () => {
		const cursor = {
			v: 1 as const,
			state: "inbox" as const,
			stateChangedAt,
			id: "9007199254740993",
		};
		const encoded = encodeThreadCursor(cursor);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeThreadCursor(encoded, "inbox")).toEqual(cursor);
	});

	it("요청 상태와 다른 cursor를 거부한다", () => {
		const encoded = encodeThreadCursor({ v: 1, state: "saved", stateChangedAt, id: "1" });
		expect(() => decodeThreadCursor(encoded, "trash")).toThrow("Invalid thread cursor.");
	});

	it("손상되거나 범위를 벗어난 cursor를 거부한다", () => {
		expect(() => decodeThreadCursor("broken")).toThrow("Invalid thread cursor.");
		expect(() =>
			decodeThreadCursor(
				encodeThreadCursor({ v: 1, state: "inbox", stateChangedAt, id: "9223372036854775808" })
			)
		).toThrow("Invalid thread cursor.");
	});

	it("limit 기본값과 최대값을 적용한다", () => {
		expect(parseThreadListParams(request("/api/threads?state=inbox"), "inbox").limit).toBe(24);
		expect(
			parseThreadListParams(request("/api/threads?state=inbox&limit=1000"), "inbox").limit
		).toBe(100);
	});
});

describe("thread list API", () => {
	beforeEach(() => {
		createClientMock.mockReset();
		rpcMock.mockReset();
	});

	it("정식 상태 목록이 새 RPC와 cursor 계약을 사용한다", async () => {
		mockOwner();
		const response = await getThreads(request("/api/threads?state=inbox&limit=2"));
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.items).toEqual(rows.slice(0, 2));
		expect(decodeThreadCursor(body.nextCursor, "inbox")).toEqual({
			v: 1,
			state: "inbox",
			stateChangedAt,
			id: "2",
		});
		expect(rpcMock).toHaveBeenLastCalledWith("list_threads_page", {
			p_state: "inbox",
			p_limit: 2,
			p_cursor_state_changed_at: null,
			p_cursor_id: null,
			p_filter_type: null,
		});
	});

	it("cursor와 필터를 RPC 복합 경계값으로 전달한다", async () => {
		mockOwner([]);
		const cursor = encodeThreadCursor({ v: 1, state: "inbox", stateChangedAt, id: "2" });
		const response = await getThreads(
			request(`/api/threads?state=inbox&cursor=${cursor}&filterType=normal`)
		);
		expect(response.status).toBe(200);
		expect(rpcMock).toHaveBeenLastCalledWith("list_threads_page", {
			p_state: "inbox",
			p_limit: 24,
			p_cursor_state_changed_at: stateChangedAt,
			p_cursor_id: "2",
			p_filter_type: "normal",
		});
	});

	it("잘못된 상태와 cursor에는 400을 반환한다", async () => {
		mockOwner();
		expect((await getThreads(request("/api/threads?state=unknown"))).status).toBe(400);
		const wrongStateCursor = encodeThreadCursor({ v: 1, state: "saved", stateChangedAt, id: "1" });
		expect(
			(await getThreads(request(`/api/threads?state=inbox&cursor=${wrongStateCursor}`))).status
		).toBe(400);
		expect((await getThreads(request("/api/threads?state=trash&cursor=broken"))).status).toBe(400);
	});
});
