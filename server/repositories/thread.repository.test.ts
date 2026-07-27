import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/errors/domain-error";
import { threadRow } from "@/test/support/communication";
import { ThreadRepository } from "./thread.repository";

describe("ThreadRepository", () => {
	const rpc = vi.fn();
	const repository = new ThreadRepository({ rpc } as unknown as SupabaseClient);

	beforeEach(() => rpc.mockReset());

	it("목록 RPC의 cursor와 필터 계약을 보존하고 ID를 string으로 정규화한다", async () => {
		rpc.mockResolvedValue({
			data: [{ ...threadRow, id: "9007199254740993" }],
			error: null,
		});

		const result = await repository.list("inbox", {
			limit: 24,
			cursor: { stateChangedAt: threadRow.state_changed_at, id: "2" },
			filterType: "youtube",
		});

		expect(result[0].id).toBe("9007199254740993");
		expect(rpc).toHaveBeenCalledWith("list_threads_page", {
			p_state: "inbox",
			p_limit: 24,
			p_cursor_state_changed_at: threadRow.state_changed_at,
			p_cursor_id: "2",
			p_filter_type: "youtube",
		});
	});

	it("손상된 목록 응답을 fail closed 한다", async () => {
		rpc.mockResolvedValue({ data: [{ ...threadRow, state: "unknown" }], error: null });
		await expect(
			repository.list("inbox", { limit: 24, cursor: null, filterType: null })
		).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});

	it("통계의 numeric string을 유한 정수로 정규화한다", async () => {
		rpc.mockResolvedValue({
			data: [{ key: "youtube", label: "youtube", count: "2", total_count: "5" }],
			error: null,
		});
		await expect(repository.stats("inbox", null)).resolves.toEqual([
			{ key: "youtube", label: "youtube", count: 2, total_count: 5 },
		]);
	});

	it.each([
		["22023", "InvalidInput"],
		["P0002", "NotFound"],
		["40001", "StateConflict"],
		["42501", "Forbidden"],
		["XX000", "UnexpectedFailure"],
	] as const)("상태 이동 RPC 오류 %s를 %s domain error로 변환한다", async (code, expected) => {
		rpc.mockResolvedValue({
			data: null,
			error: { code, message: "database error", details: "", hint: "" },
		});

		const error = await repository
			.transition({ id: "12", expectedState: "inbox", destinationState: "trash" })
			.catch((caught) => caught);
		expect(error).toBeInstanceOf(DomainError);
		expect(error).toMatchObject({ code: expected });
	});

	it("상태 이동 결과의 공개 shape를 검증한다", async () => {
		rpc.mockResolvedValue({
			data: {
				...threadRow,
				id: "9007199254740993",
				state: "saved",
				media_metadata: undefined,
			},
			error: null,
		});
		const result = await repository.transition({
			id: "9007199254740993",
			expectedState: "inbox",
			destinationState: "saved",
		});
		expect(result).toMatchObject({ id: "9007199254740993", state: "saved" });
		expect(rpc).toHaveBeenCalledWith("transition_thread_state", {
			p_thread_id: "9007199254740993",
			p_expected_state: "inbox",
			p_destination_state: "saved",
		});
	});

	it("bulk-trash 이동 건수를 number로 정규화한다", async () => {
		rpc.mockResolvedValue({ data: "7", error: null });
		await expect(repository.bulkTrashInbox()).resolves.toBe(7);
		expect(rpc).toHaveBeenCalledWith("bulk_move_inbox_to_trash");
	});
});
