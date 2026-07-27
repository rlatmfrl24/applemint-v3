import type { TRPCClient } from "@trpc/client";
import { describe, expect, it, vi } from "vitest";
import type { AppRouter } from "@/server/trpc/router";
import {
	bulkTrashInboxOptions,
	threadListOptions,
	threadStatsOptions,
	transitionThreadOptions,
} from "./thread-query-options";

function createClient() {
	const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
	const stats = vi.fn().mockResolvedValue({ counts: [], totalCount: 0 });
	const transition = vi.fn().mockResolvedValue({ id: "1" });
	const bulkTrash = vi.fn().mockResolvedValue({ movedCount: 3 });
	return {
		client: {
			thread: {
				list: { query: list },
				stats: { query: stats },
				transition: { mutate: transition },
				bulkTrash: { mutate: bulkTrash },
			},
		} as unknown as TRPCClient<AppRouter>,
		list,
		stats,
		transition,
		bulkTrash,
	};
}

describe("thread tRPC query options", () => {
	it("기존 cache key와 stale 정책을 보존한다", () => {
		const { client } = createClient();
		expect(threadListOptions(client, { state: "inbox", filterType: "normal" }).queryKey).toEqual([
			"threads",
			"list",
			"inbox",
			"filterType:normal",
		]);
		expect(threadListOptions(client, { state: "inbox" }).staleTime).toBe(30_000);
		expect(threadStatsOptions(client, "trash", "normal").queryKey).toEqual([
			"threads",
			"stats",
			"trash",
			"normal",
		]);
		expect(threadStatsOptions(client, "trash").staleTime).toBe(300_000);
	});

	it("목록 cursor와 AbortSignal을 tRPC query에 전달한다", async () => {
		const { client, list } = createClient();
		const options = threadListOptions(client, {
			state: "saved",
			limit: 10,
			filterType: null,
		});
		const signal = new AbortController().signal;
		if (typeof options.queryFn !== "function") throw new Error("queryFn이 필요합니다.");
		await options.queryFn({ pageParam: "cursor", signal } as never);

		expect(list).toHaveBeenCalledWith(
			{
				state: "saved",
				limit: 10,
				filterType: null,
				cursor: "cursor",
			},
			{ signal }
		);
	});

	it("통계 query가 filter와 AbortSignal을 전달한다", async () => {
		const { client, stats } = createClient();
		const options = threadStatsOptions(client, "inbox", "youtube");
		const signal = new AbortController().signal;
		if (typeof options.queryFn !== "function") throw new Error("queryFn이 필요합니다.");
		await options.queryFn({ signal } as never);
		expect(stats).toHaveBeenCalledWith({ state: "inbox", filterType: "youtube" }, { signal });
	});

	it("상태 이동과 일괄 이동은 정식 tRPC procedure를 호출한다", async () => {
		const { client, transition, bulkTrash } = createClient();
		const transitionOptions = transitionThreadOptions(client);
		const bulkOptions = bulkTrashInboxOptions(client);
		await transitionOptions.mutationFn?.(
			{ id: "1", expectedState: "inbox", destinationState: "trash" },
			{} as never
		);
		await expect(bulkOptions.mutationFn?.(undefined, {} as never)).resolves.toBe(3);

		expect(transition).toHaveBeenCalledWith({
			id: "1",
			expectedState: "inbox",
			destinationState: "trash",
		});
		expect(bulkTrash).toHaveBeenCalledOnce();
	});
});
