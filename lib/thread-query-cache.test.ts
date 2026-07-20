import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
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
		const sourceKey = ["new-threads", ""] as const;
		const sourceData = {
			pages: [{ items: [thread], nextCursor: null } satisfies ThreadInfinitePage],
			pageParams: [undefined],
		};
		queryClient.setQueryData(sourceKey, sourceData);
		queryClient.setQueryData(["new-threads", "stats"], {
			counts: [{ key: "normal", label: "normal", count: 1 }],
			totalCount: 1,
		});
		queryClient.setQueryData(["trash"], []);

		const snapshots = applyMoveThreadOptimisticUpdates(queryClient, {
			sourceTable: "new-threads",
			destinationTable: "trash",
			thread,
		});

		expect(queryClient.getQueryData<typeof sourceData>(sourceKey)?.pages[0].items).toEqual([]);
		expect(queryClient.getQueryData<ThreadItemType[]>(["trash"])).toHaveLength(1);

		rollbackSnapshots(queryClient, snapshots);

		expect(queryClient.getQueryData(sourceKey)).toEqual(sourceData);
		expect(queryClient.getQueryData(["trash"])).toEqual([]);
		expect(queryClient.getQueryData(["new-threads", "stats"])).toEqual({
			counts: [{ key: "normal", label: "normal", count: 1 }],
			totalCount: 1,
		});
		queryClient.clear();
	});

	it("성공 후 관련 목록과 통계를 invalidate한다", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["new-threads", ""], { pages: [], pageParams: [] });
		queryClient.setQueryData(["new-threads", "stats"], { counts: [] });
		queryClient.setQueryData(["trash"], []);

		await invalidateThreadQueries(queryClient, ["new-threads", "trash"]);

		expect(queryClient.getQueryState(["new-threads", ""])?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(["new-threads", "stats"])?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(["trash"])?.isInvalidated).toBe(true);
		queryClient.clear();
	});
});
