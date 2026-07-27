import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadRepository } from "@/server/repositories/thread.repository";
import { threadRow } from "@/test/support/communication";
import { decodeThreadCursor, encodeThreadCursor, ThreadService } from "./thread.service";

describe("ThreadService", () => {
	const repository = {
		list: vi.fn(),
		stats: vi.fn(),
		transition: vi.fn(),
		bulkTrashInbox: vi.fn(),
	};
	const service = new ThreadService(repository as unknown as ThreadRepository);

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

	it("limit+1 결과에서 다음 cursor를 생성한다", async () => {
		repository.list.mockResolvedValue([
			{ ...threadRow, id: "3" },
			{ ...threadRow, id: "2" },
			{ ...threadRow, id: "1" },
		]);
		const result = await service.list({ state: "inbox", limit: 2 });

		expect(result.items.map((item) => item.id)).toEqual(["3", "2"]);
		expect(result.nextCursor).not.toBeNull();
		expect(decodeThreadCursor(result.nextCursor ?? "", "inbox")).toEqual({
			stateChangedAt: threadRow.state_changed_at,
			id: "2",
		});
	});

	it("입력 cursor를 repository 복합 경계로 전달한다", async () => {
		repository.list.mockResolvedValue([]);
		const cursor = encodeThreadCursor({
			v: 1,
			state: "inbox",
			stateChangedAt: threadRow.state_changed_at,
			id: "2",
		});
		await service.list({ state: "inbox", limit: 24, filterType: "youtube", cursor });
		expect(repository.list).toHaveBeenCalledWith("inbox", {
			limit: 24,
			cursor: { stateChangedAt: threadRow.state_changed_at, id: "2" },
			filterType: "youtube",
		});
	});

	it("통계 표시 라벨과 totalCount를 정규화한다", async () => {
		repository.stats.mockResolvedValue([
			{ key: "youtube", label: "youtube", count: 3, total_count: 5 },
			{ key: "imgur", label: "imgur", count: 2, total_count: 5 },
		]);
		await expect(service.stats({ state: "inbox" })).resolves.toEqual({
			totalCount: 5,
			counts: [
				{ key: "youtube", label: "YouTube", count: 3 },
				{ key: "imgur", label: "Imgur", count: 2 },
			],
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
