import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));

import { PATCH as patchThreadState } from "./threads/[id]/state/route";
import { POST as bulkTrash } from "./threads/bulk-trash/route";

const request = (body: unknown) =>
	new Request("http://localhost/api/threads/12/state", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	}) as NextRequest;

const context = (id = "12") => ({ params: Promise.resolve({ id }) });

function mockOwner(result: { data: unknown; error: unknown }) {
	rpcMock.mockImplementation((name: string) => {
		if (name === "is_applemint_owner") return Promise.resolve({ data: true, error: null });
		return Promise.resolve(result);
	});
	createClientMock.mockResolvedValue({
		auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } }, error: null }) },
		rpc: rpcMock,
	});
}

describe("thread state API", () => {
	beforeEach(() => {
		createClientMock.mockReset();
		rpcMock.mockReset();
	});

	it("조건부 상태 이동의 갱신 행을 그대로 반환한다", async () => {
		const item = { id: "12", state: "saved", state_changed_at: "2026-07-22T00:00:00.000Z" };
		mockOwner({ data: item, error: null });

		const response = await patchThreadState(
			request({ expectedState: "inbox", destinationState: "saved" }),
			context()
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ item });
		expect(rpcMock).toHaveBeenLastCalledWith("transition_thread_state", {
			p_thread_id: "12",
			p_expected_state: "inbox",
			p_destination_state: "saved",
		});
	});

	it.each([
		["22023", 400],
		["P0002", 404],
		["40001", 409],
		["42501", 403],
	] as const)("RPC 오류 %s를 HTTP %s로 변환한다", async (code, status) => {
		mockOwner({ data: null, error: { code, message: `rpc ${code}` } });
		const response = await patchThreadState(
			request({ expectedState: "inbox", destinationState: "trash" }),
			context()
		);
		expect(response.status).toBe(status);
		expect(await response.json()).toEqual({ error: `rpc ${code}` });
	});

	it("잘못된 ID와 상태는 RPC 호출 전에 거부한다", async () => {
		expect(
			(
				await patchThreadState(
					request({ expectedState: "inbox", destinationState: "trash" }),
					context("x")
				)
			).status
		).toBe(400);
		expect(
			(
				await patchThreadState(
					request({ expectedState: "inbox", destinationState: "unknown" }),
					context()
				)
			).status
		).toBe(400);
		expect(createClientMock).not.toHaveBeenCalled();
	});

	it("bulk-trash가 이동 건수를 정규화한다", async () => {
		mockOwner({ data: "7", error: null });
		const response = await bulkTrash();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ movedCount: 7 });
		expect(rpcMock).toHaveBeenLastCalledWith("bulk_move_inbox_to_trash");
	});
});
