import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { threadListQueryKey } from "./thread-list-contract";
import {
	applyMoveThreadOptimisticUpdates,
	invalidateThreadQueries,
	rollbackSnapshots,
	type ThreadInfinitePage,
} from "./thread-query-cache";
import type { ThreadItemType } from "./type-defs";

const thread: ThreadItemType = {
	id: "1",
	type: "normal",
	url: "https://example.com/1",
	title: "one",
	description: "description",
	host: "example.com",
	tag: ["test"],
	created_at: "2026-07-20T00:00:00.000Z",
	captured_at: "2026-07-19T00:00:00.000Z",
};

describe("thread query cache", () => {
	it("optimistic 이동 실패 시 원본 cache로 rollback한다", () => {
		const queryClient = new QueryClient();
		const sourceKey = threadListQueryKey("new-threads");
		const trashKey = threadListQueryKey("trash");
		const sourceData = {
			pages: [{ items: [thread], nextCursor: null } satisfies ThreadInfinitePage],
			pageParams: [undefined],
		};
		queryClient.setQueryData(sourceKey, sourceData);
		queryClient.setQueryData(["new-threads", "stats"], {
			counts: [{ key: "normal", label: "normal", count: 1 }],
			totalCount: 1,
		});
		const trashData = {
			pages: [{ items: [], nextCursor: null } satisfies ThreadInfinitePage],
			pageParams: [undefined],
		};
		queryClient.setQueryData(trashKey, trashData);

		const snapshots = applyMoveThreadOptimisticUpdates(queryClient, {
			sourceTable: "new-threads",
			destinationTable: "trash",
			thread,
		});

		expect(queryClient.getQueryData<typeof sourceData>(sourceKey)?.pages[0].items).toEqual([]);
		expect(queryClient.getQueryData<typeof trashData>(trashKey)?.pages[0].items).toHaveLength(1);

		rollbackSnapshots(queryClient, snapshots);

		expect(queryClient.getQueryData(sourceKey)).toEqual(sourceData);
		expect(queryClient.getQueryData(trashKey)).toEqual(trashData);
		expect(queryClient.getQueryData(["new-threads", "stats"])).toEqual({
			counts: [{ key: "normal", label: "normal", count: 1 }],
			totalCount: 1,
		});
		queryClient.clear();
	});

	it("Quick에서 Trash로 이동할 때 모든 infinite page cache를 갱신한다", () => {
		const queryClient = new QueryClient();
		const quickKey = threadListQueryKey("quick-save");
		const trashKey = threadListQueryKey("trash");
		const secondThread = { ...thread, id: "2", url: "https://example.com/2" };
		queryClient.setQueryData(quickKey, {
			pages: [
				{ items: [secondThread], nextCursor: "next" },
				{ items: [thread], nextCursor: null },
			],
			pageParams: [undefined, "next"],
		});
		queryClient.setQueryData(trashKey, {
			pages: [{ items: [], nextCursor: null }],
			pageParams: [undefined],
		});

		applyMoveThreadOptimisticUpdates(queryClient, {
			sourceTable: "quick-save",
			destinationTable: "trash",
			thread,
		});

		const quickData = queryClient.getQueryData<{
			pages: ThreadInfinitePage[];
		}>(quickKey);
		const trashData = queryClient.getQueryData<{
			pages: ThreadInfinitePage[];
		}>(trashKey);
		expect(quickData?.pages.flatMap((page) => page.items)).toEqual([secondThread]);
		expect(trashData?.pages[0].items).toHaveLength(1);
		queryClient.clear();
	});

	it("성공 후 관련 목록과 통계를 invalidate한다", async () => {
		const queryClient = new QueryClient();
		const newThreadsKey = threadListQueryKey("new-threads");
		const trashKey = threadListQueryKey("trash");
		queryClient.setQueryData(newThreadsKey, { pages: [], pageParams: [] });
		queryClient.setQueryData(["new-threads", "stats"], { counts: [] });
		queryClient.setQueryData(trashKey, { pages: [], pageParams: [] });

		await invalidateThreadQueries(queryClient, ["new-threads", "trash"]);

		expect(queryClient.getQueryState(newThreadsKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(["new-threads", "stats"])?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(trashKey)?.isInvalidated).toBe(true);
		queryClient.clear();
	});
});
