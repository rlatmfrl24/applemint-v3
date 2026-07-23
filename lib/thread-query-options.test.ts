import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bulkTrashInboxOptions,
	fetchThreadPage,
	threadListOptions,
	threadStatsOptions,
	transitionThreadOptions,
} from "./thread-query-options";

afterEach(() => vi.unstubAllGlobals());

describe("thread query options", () => {
	it("상태와 필터를 공통 query key에 반영한다", () => {
		expect(threadListOptions({ state: "inbox", filterType: "normal" }).queryKey).toEqual([
			"threads",
			"list",
			"inbox",
			"filterType:normal",
		]);
		expect(threadStatsOptions("trash", "normal").queryKey).toEqual([
			"threads",
			"stats",
			"trash",
			"normal",
		]);
	});

	it("목록 요청에 AbortSignal을 전달한다", async () => {
		const signal = new AbortController().signal;
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ items: [], nextCursor: null }) });
		vi.stubGlobal("fetch", fetchMock);

		await fetchThreadPage({ state: "saved", limit: 10, filterType: null, signal });

		expect(fetchMock).toHaveBeenCalledWith("/api/threads?state=saved&limit=10", { signal });
	});

	it("상태 이동과 일괄 이동 mutation factory가 정식 API를 호출한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ item: { id: "1" } }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ movedCount: 3 }) });
		vi.stubGlobal("fetch", fetchMock);

		await transitionThreadOptions().mutationFn?.(
			{ id: "1", expectedState: "inbox", destinationState: "trash" },
			{} as never
		);
		await bulkTrashInboxOptions().mutationFn?.(undefined, {} as never);

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/threads/1/state",
			expect.objectContaining({ method: "PATCH" })
		);
		expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/threads/bulk-trash", { method: "POST" });
	});
});
