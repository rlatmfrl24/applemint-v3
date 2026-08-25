import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { threadListQueryKey } from "./thread-list-contract";
import {
	applyMoveThreadOptimisticUpdates,
	invalidateThreadQueries,
	replaceThreadInCaches,
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
	state: "inbox",
	state_changed_at: "2026-07-20T00:00:00.000Z",
	media_metadata: null,
};

const youtubeMetadata: NonNullable<ThreadItemType["media_metadata"]> = {
	provider: "youtube",
	external_id: "abcdefghijk",
	media_kind: "video",
	status: "ready",
	title: "공식 제목",
	channel_title: "공식 채널",
	thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
	duration_seconds: 125,
	live_status: "none",
	last_error_code: null,
	fetched_at: "2026-07-22T00:00:00.000Z",
	updated_at: "2026-07-22T00:00:00.000Z",
};

const youtubeThread: ThreadItemType = {
	...thread,
	type: "youtube",
	url: "https://www.youtube.com/watch?v=abcdefghijk",
	media_metadata: youtubeMetadata,
};

const imgurThread: ThreadItemType = {
	...thread,
	type: "imgur",
	url: "https://imgur.com/a/Album12",
	media_metadata: null,
};

const cycleStates = ["inbox", "saved", "trash"] as const;

function seedMediaCycleCaches(
	queryClient: QueryClient,
	mediaThread: ThreadItemType,
	filterType: "youtube" | "imgur",
	label: "YouTube" | "Imgur"
) {
	for (const state of cycleStates) {
		const items = state === "inbox" ? [mediaThread] : [];
		for (const filterKey of ["", `filterType:${filterType}`]) {
			queryClient.setQueryData(threadListQueryKey(state, filterKey), {
				pages: [{ items, nextCursor: null }],
				pageParams: [undefined],
			});
		}
		queryClient.setQueryData(threadListQueryKey(state, "filterType:normal"), {
			pages: [{ items: [], nextCursor: null }],
			pageParams: [undefined],
		});
		for (const statsFilter of [null, filterType]) {
			queryClient.setQueryData(["threads", "stats", state, statsFilter], {
				counts: state === "inbox" ? [{ key: filterType, label, count: 1 }] : [],
				hostCounts: [],
				totalCount: state === "inbox" ? 1 : 0,
			});
		}
	}
}

function moveCachedThread(
	queryClient: QueryClient,
	sourceState: (typeof cycleStates)[number],
	destinationState: (typeof cycleStates)[number]
) {
	const current = queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(
		threadListQueryKey(sourceState)
	)?.pages[0].items[0] as ThreadItemType;
	applyMoveThreadOptimisticUpdates(queryClient, {
		sourceState,
		destinationState,
		thread: current,
	});
}

describe("thread query cache", () => {
	it("optimistic 이동 실패 시 원본 cache로 rollback한다", () => {
		const queryClient = new QueryClient();
		const sourceKey = threadListQueryKey("inbox");
		const trashKey = threadListQueryKey("trash");
		const sourceData = {
			pages: [{ items: [thread], nextCursor: null } satisfies ThreadInfinitePage],
			pageParams: [undefined],
		};
		queryClient.setQueryData(sourceKey, sourceData);
		queryClient.setQueryData(["threads", "stats", "inbox", null], {
			counts: [{ key: "normal", label: "normal", count: 1 }],
			hostCounts: [],
			totalCount: 1,
		});
		const trashData = {
			pages: [{ items: [], nextCursor: null } satisfies ThreadInfinitePage],
			pageParams: [undefined],
		};
		queryClient.setQueryData(trashKey, trashData);

		const snapshots = applyMoveThreadOptimisticUpdates(queryClient, {
			sourceState: "inbox",
			destinationState: "trash",
			thread,
		});

		expect(queryClient.getQueryData<typeof sourceData>(sourceKey)?.pages[0].items).toEqual([]);
		expect(queryClient.getQueryData<typeof trashData>(trashKey)?.pages[0].items).toHaveLength(1);

		rollbackSnapshots(queryClient, snapshots);

		expect(queryClient.getQueryData(sourceKey)).toEqual(sourceData);
		expect(queryClient.getQueryData(trashKey)).toEqual(trashData);
		expect(queryClient.getQueryData(["threads", "stats", "inbox", null])).toEqual({
			counts: [{ key: "normal", label: "normal", count: 1 }],
			hostCounts: [],
			totalCount: 1,
		});
		queryClient.clear();
	});

	it("Quick에서 Trash로 이동할 때 모든 infinite page cache를 갱신한다", () => {
		const queryClient = new QueryClient();
		const quickKey = threadListQueryKey("saved");
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
			sourceState: "saved",
			destinationState: "trash",
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
		expect(trashData?.pages[0].items[0]).toEqual(
			expect.objectContaining({
				id: thread.id,
				state: "trash",
				created_at: thread.created_at,
				captured_at: thread.captured_at,
			})
		);
		expect(String(trashData?.pages[0].items[0]?.id)).not.toContain("optimistic");

		const serverThread = {
			...thread,
			state: "trash" as const,
			state_changed_at: "2026-07-22T01:02:03.000Z",
		};
		replaceThreadInCaches(queryClient, serverThread);
		expect(
			queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(trashKey)?.pages[0].items[0]
		).toEqual(serverThread);
		queryClient.clear();
	});

	it("공급자 통계가 새로 생기면 표시 라벨을 유지한다", () => {
		const queryClient = new QueryClient();
		const youtubeThread = {
			...thread,
			type: "youtube",
			url: "https://www.youtube.com/watch?v=video",
		};
		queryClient.setQueryData(["threads", "stats", "trash", null], {
			counts: [],
			hostCounts: [],
			totalCount: 0,
		});

		applyMoveThreadOptimisticUpdates(queryClient, {
			sourceState: "inbox",
			destinationState: "trash",
			thread: youtubeThread,
		});

		expect(queryClient.getQueryData(["threads", "stats", "trash", null])).toEqual({
			counts: [{ key: "youtube", label: "YouTube", count: 1 }],
			hostCounts: [],
			totalCount: 1,
		});
		queryClient.clear();
	});

	it("optimistic 상태 이동과 metadata 없는 transition 응답에서도 media metadata를 보존한다", () => {
		const queryClient = new QueryClient();
		const inboxKey = threadListQueryKey("inbox");
		const savedKey = threadListQueryKey("saved");
		const mediaThread: ThreadItemType = {
			...thread,
			type: "youtube",
			url: "https://www.youtube.com/watch?v=video",
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
				last_error_code: null,
				fetched_at: "2026-07-22T00:00:00.000Z",
				updated_at: "2026-07-22T00:00:00.000Z",
			},
		};
		queryClient.setQueryData(inboxKey, {
			pages: [{ items: [mediaThread], nextCursor: null }],
			pageParams: [undefined],
		});
		queryClient.setQueryData(savedKey, {
			pages: [{ items: [], nextCursor: null }],
			pageParams: [undefined],
		});

		applyMoveThreadOptimisticUpdates(queryClient, {
			sourceState: "inbox",
			destinationState: "saved",
			thread: mediaThread,
		});

		expect(
			queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(savedKey)?.pages[0].items[0]
				?.media_metadata
		).toEqual(mediaThread.media_metadata);

		const { media_metadata: _omitted, ...transitionRow } = {
			...mediaThread,
			state: "saved" as const,
			state_changed_at: "2026-07-22T01:02:03.000Z",
		};
		replaceThreadInCaches(queryClient, transitionRow as ThreadItemType);

		expect(
			queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(savedKey)?.pages[0].items[0]
				?.media_metadata
		).toEqual(mediaThread.media_metadata);
		queryClient.clear();
	});

	it("YouTube metadata를 필터별 목록과 통계에서 inbox→saved→trash→inbox 동안 보존한다", () => {
		const queryClient = new QueryClient();
		seedMediaCycleCaches(queryClient, youtubeThread, "youtube", "YouTube");

		moveCachedThread(queryClient, "inbox", "saved");
		moveCachedThread(queryClient, "saved", "trash");
		moveCachedThread(queryClient, "trash", "inbox");

		for (const key of [
			threadListQueryKey("inbox"),
			threadListQueryKey("inbox", "filterType:youtube"),
		]) {
			const item = queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(key)?.pages[0]
				.items[0];
			expect(item?.state).toBe("inbox");
			expect(item?.media_metadata).toEqual(youtubeMetadata);
		}
		expect(
			queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(
				threadListQueryKey("inbox", "filterType:normal")
			)?.pages[0].items
		).toEqual([]);
		expect(queryClient.getQueryData(["threads", "stats", "inbox", null])).toEqual({
			counts: [{ key: "youtube", label: "YouTube", count: 1 }],
			hostCounts: [],
			totalCount: 1,
		});
		expect(queryClient.getQueryData(["threads", "stats", "inbox", "youtube"])).toEqual({
			counts: [{ key: "youtube", label: "YouTube", count: 1 }],
			hostCounts: [],
			totalCount: 1,
		});
		for (const state of cycleStates.slice(1)) {
			expect(
				queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(threadListQueryKey(state))
					?.pages[0].items
			).toEqual([]);
			expect(queryClient.getQueryData(["threads", "stats", state, null])).toEqual({
				counts: [],
				hostCounts: [],
				totalCount: 0,
			});
		}
		queryClient.clear();
	});

	it("metadata 없는 Imgur 일반 카드 항목과 필터 통계를 모든 상태 이동에서 보존한다", () => {
		const queryClient = new QueryClient();
		seedMediaCycleCaches(queryClient, imgurThread, "imgur", "Imgur");

		moveCachedThread(queryClient, "inbox", "saved");
		moveCachedThread(queryClient, "saved", "trash");
		moveCachedThread(queryClient, "trash", "inbox");

		for (const key of [
			threadListQueryKey("inbox"),
			threadListQueryKey("inbox", "filterType:imgur"),
		]) {
			const item = queryClient.getQueryData<{ pages: ThreadInfinitePage[] }>(key)?.pages[0]
				.items[0];
			expect(item?.state).toBe("inbox");
			expect(item?.media_metadata).toBeNull();
		}
		expect(queryClient.getQueryData(["threads", "stats", "inbox", null])).toEqual({
			counts: [{ key: "imgur", label: "Imgur", count: 1 }],
			hostCounts: [],
			totalCount: 1,
		});
		expect(queryClient.getQueryData(["threads", "stats", "inbox", "imgur"])).toEqual({
			counts: [{ key: "imgur", label: "Imgur", count: 1 }],
			hostCounts: [],
			totalCount: 1,
		});
		queryClient.clear();
	});

	it("성공 후 관련 목록과 통계를 invalidate한다", async () => {
		const queryClient = new QueryClient();
		const newThreadsKey = threadListQueryKey("inbox");
		const trashKey = threadListQueryKey("trash");
		queryClient.setQueryData(newThreadsKey, { pages: [], pageParams: [] });
		queryClient.setQueryData(["threads", "stats", "inbox", null], {
			counts: [],
			hostCounts: [],
			totalCount: 0,
		});
		queryClient.setQueryData(trashKey, { pages: [], pageParams: [] });

		await invalidateThreadQueries(queryClient, ["inbox", "trash"]);

		expect(queryClient.getQueryState(newThreadsKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(["threads", "stats", "inbox", null])?.isInvalidated).toBe(
			true
		);
		expect(queryClient.getQueryState(trashKey)?.isInvalidated).toBe(true);
		queryClient.clear();
	});
});
