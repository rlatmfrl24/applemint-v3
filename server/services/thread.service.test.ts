import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadStore } from "@/server/ports/thread.store";
import { threadRow } from "@/test/support/communication";
import { decodeThreadCursor, encodeThreadCursor, ThreadService } from "./thread.service";

describe("ThreadService", () => {
	const repository = {
		list: vi.fn(),
		stats: vi.fn(),
		transition: vi.fn(),
		bulkTrashInbox: vi.fn(),
	};
	const service = new ThreadService(repository as unknown as ThreadStore);

	beforeEach(() => {
		for (const mock of Object.values(repository)) mock.mockReset();
	});

	it("버전과 상태를 포함한 Base64URL cursor를 왕복한다", () => {
		const encoded = encodeThreadCursor({
			v: 1,
			state: "inbox",
			stateChangedAt: threadRow.state_changed_at,
			id: "9007199254740993",
		});
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
		expect(decodeThreadCursor(encoded, "inbox")).toEqual({
			stateChangedAt: threadRow.state_changed_at,
			id: "9007199254740993",
		});
	});

	it("손상·상태 불일치·bigint 범위 초과 cursor를 거부한다", () => {
		const wrongState = encodeThreadCursor({
			v: 1,
			state: "saved",
			stateChangedAt: threadRow.state_changed_at,
			id: "1",
		});
		const overflow = encodeThreadCursor({
			v: 1,
			state: "inbox",
			stateChangedAt: threadRow.state_changed_at,
			id: "9223372036854775808",
		});
		expect(() => decodeThreadCursor("broken", "inbox")).toThrow("올바르지 않은 목록 커서");
		expect(() => decodeThreadCursor(wrongState, "trash")).toThrow("올바르지 않은 목록 커서");
		expect(() => decodeThreadCursor(overflow, "inbox")).toThrow("올바르지 않은 목록 커서");
	});

	it("limit+1 결과에서 마이크로초를 유지하는 다음 cursor를 생성한다", async () => {
		const row = { ...threadRow, state_changed_at: "2026-07-09T00:00:00.123456+00:00" };
		repository.list.mockResolvedValue([
			{ ...row, id: "3" },
			{ ...row, id: "2" },
			{ ...row, id: "1" },
		]);
		const result = await service.list({ state: "inbox", limit: 2 });

		expect(result.items.map((item) => item.id)).toEqual(["3", "2"]);
		expect(result.nextCursor).not.toBeNull();
		expect(decodeThreadCursor(result.nextCursor ?? "", "inbox")).toEqual({
			stateChangedAt: "2026-07-09T00:00:00.123456Z",
			id: "2",
		});
	});

	it.each([
		["3", "4", "2026-07-09T00:00:00.123999Z", "4", "2026-07-09T00:00:00.123999Z"],
		["9223372036854775807", "5", "2026-07-09T00:00:00.124Z", "1", "2026-07-09T00:00:00.124000Z"],
	])(
		"새 글이 들어와도 첫 페이지 경계(%s)와 이전 글을 유지한다",
		async (id, newId, arrivedAt, boundId, boundTime) => {
			const head = { ...threadRow, id, state_changed_at: "2026-07-09T00:00:00.123999Z" };
			const older = { ...head, id: "1" };
			const arrival = { ...threadRow, id: newId, state_changed_at: arrivedAt };
			repository.list.mockResolvedValueOnce([head, older]);
			const initial = await service.list({ state: "inbox", limit: 2 });
			const inboxViewCursor = initial.inboxWindow?.cursor ?? undefined;
			expect(inboxViewCursor).toBeTruthy();

			repository.list
				.mockResolvedValueOnce([arrival, head, older])
				.mockResolvedValueOnce([head, older]);
			const refreshed = await service.list({ state: "inbox", limit: 2, inboxViewCursor });
			expect(refreshed).toEqual({
				items: [head, older],
				nextCursor: null,
				inboxWindow: { cursor: inboxViewCursor, hasNew: true },
			});
			expect(repository.list).toHaveBeenLastCalledWith(
				"inbox",
				expect.objectContaining({ cursor: { id: boundId, stateChangedAt: boundTime } })
			);

			repository.list.mockResolvedValueOnce([older]);
			const afterDelete = await service.list({ state: "inbox", limit: 2, inboxViewCursor });
			expect(afterDelete.inboxWindow).toEqual({ cursor: inboxViewCursor, hasNew: false });
		}
	);

	it("입력 cursor를 repository 복합 경계로 전달한다", async () => {
		repository.list.mockResolvedValue([]);
		const cursor = encodeThreadCursor({
			v: 1,
			state: "inbox",
			stateChangedAt: threadRow.state_changed_at,
			id: "2",
		});
		await service.list({
			state: "inbox",
			limit: 24,
			filterType: "normal",
			filterSite: "fmkorea.com",
			cursor,
		});
		expect(repository.list).toHaveBeenCalledWith("inbox", {
			limit: 24,
			cursor: { stateChangedAt: threadRow.state_changed_at, id: "2" },
			filterType: "normal",
			filterSite: "fmkorea.com",
		});
	});

	it("통계 표시 라벨과 totalCount를 정규화한다", async () => {
		repository.stats.mockResolvedValue({
			rows: [
				{ key: "normal", count: 20, total_count: 25 },
				{ key: "youtube", count: 5, total_count: 25 },
			],
			sites: [{ site_key: "fmkorea.com", count: 12 }],
		});
		await expect(service.stats({ state: "inbox" })).resolves.toEqual({
			totalCount: 25,
			counts: [
				{ key: "normal", label: "normal", count: 8 },
				{ key: "youtube", label: "YouTube", count: 5 },
			],
			siteCounts: [{ siteKey: "fmkorea.com", label: "에펨코리아", count: 12 }],
		});
	});

	it("Normal 통계는 승격 site 건수를 제외하고 site 분류를 중복 노출하지 않는다", async () => {
		repository.stats.mockResolvedValue({
			rows: [{ key: "normal", count: 20, total_count: 20 }],
			sites: [{ site_key: "fmkorea.com", count: 12 }],
		});

		await expect(service.stats({ state: "inbox", filterType: "normal" })).resolves.toEqual({
			totalCount: 8,
			counts: [{ key: "normal", label: "normal", count: 8 }],
			siteCounts: [],
		});
	});

	it("Inbox 전체 통계가 아니면 site 통계를 빈 배열로 유지한다", async () => {
		repository.stats.mockResolvedValue({ rows: [], sites: [] });

		await expect(service.stats({ state: "saved" })).resolves.toEqual({
			totalCount: 0,
			counts: [],
			siteCounts: [],
		});
	});

	it("상태 이동은 repository에 위임한다", async () => {
		repository.transition.mockResolvedValue({ ...threadRow, id: "12", state: "saved" });
		await service.transition({
			id: "12",
			expectedState: "inbox",
			destinationState: "saved",
		});
		expect(repository.transition).toHaveBeenCalledWith({
			id: "12",
			expectedState: "inbox",
			destinationState: "saved",
		});
	});

	it("일괄 이동 결과에 movedCount 계약을 적용한다", async () => {
		repository.bulkTrashInbox.mockResolvedValue(4);
		await expect(service.bulkTrashInbox()).resolves.toEqual({ movedCount: 4 });
	});
});
