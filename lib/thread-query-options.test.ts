import {
	dehydrate,
	focusManager,
	hydrate,
	InfiniteQueryObserver,
	QueryClient,
} from "@tanstack/react-query";
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
	const stats = vi.fn().mockResolvedValue({ counts: [], hostCounts: [], totalCount: 0 });
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
	it("기존 cache key와 stale 정책을 보존하고 focus 복귀 시 항상 갱신한다", () => {
		const { client } = createClient();
		const listOptions = threadListOptions(client, { state: "inbox", filterType: "normal" });
		const statsOptions = threadStatsOptions(client, "trash", "normal");

		expect(listOptions.queryKey).toEqual(["threads", "list", "inbox", "filterType:normal"]);
		expect(listOptions.staleTime).toBe(30_000);
		expect(listOptions.refetchOnWindowFocus).toBe("always");
		expect(statsOptions.queryKey).toEqual(["threads", "stats", "trash", "normal"]);
		expect(statsOptions.staleTime).toBe(300_000);
		expect(statsOptions.refetchOnWindowFocus).toBe("always");
	});

	it("host 필터를 cache key와 normal 목록 입력에 함께 전달한다", async () => {
		const { client, list } = createClient();
		const options = threadListOptions(client, {
			state: "inbox",
			filterType: "normal",
			filterHost: "https://www.fmkorea.com",
		});
		const signal = new AbortController().signal;
		if (typeof options.queryFn !== "function") throw new Error("queryFn이 필요합니다.");

		await options.queryFn({ pageParam: undefined, signal } as never);

		expect(options.queryKey).toEqual([
			"threads",
			"list",
			"inbox",
			"filterType:normal|filterHost:https%3A%2F%2Fwww.fmkorea.com",
		]);
		expect(list).toHaveBeenCalledWith(
			{
				state: "inbox",
				limit: 24,
				filterType: "normal",
				filterHost: "https://www.fmkorea.com",
				cursor: null,
			},
			{ signal }
		);
	});

	it("fresh 상태의 활성 목록도 focus 복귀 시 최신 데이터로 갱신한다", async () => {
		const { client, list } = createClient();
		list
			.mockResolvedValueOnce({ items: [{ id: "before" }], nextCursor: null })
			.mockResolvedValueOnce({ items: [{ id: "after" }], nextCursor: null });
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const observer = new InfiniteQueryObserver(
			queryClient,
			threadListOptions(client, { state: "inbox" })
		);

		queryClient.mount();
		const unsubscribe = observer.subscribe(() => undefined);

		try {
			await vi.waitFor(() =>
				expect(observer.getCurrentResult().data?.pages[0]?.items[0]?.id).toBe("before")
			);

			focusManager.setFocused(false);
			focusManager.setFocused(true);

			await vi.waitFor(() => {
				expect(list).toHaveBeenCalledTimes(2);
				expect(observer.getCurrentResult().data?.pages[0]?.items[0]?.id).toBe("after");
			});
		} finally {
			unsubscribe();
			queryClient.clear();
			queryClient.unmount();
			focusManager.setFocused(undefined);
		}
	});

	it("서버에서 hydration한 fresh 목록은 마운트 직후 중복 조회하지 않고 focus에서만 갱신한다", async () => {
		const { client, list } = createClient();
		const serverQueryClient = new QueryClient();
		serverQueryClient.setQueryData(["threads", "list", "saved", ""], {
			pages: [{ items: [{ id: "hydrated" }], nextCursor: null }],
			pageParams: [undefined],
		});

		const browserQueryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		hydrate(browserQueryClient, dehydrate(serverQueryClient));
		const observer = new InfiniteQueryObserver(
			browserQueryClient,
			threadListOptions(client, { state: "saved" })
		);

		browserQueryClient.mount();
		const unsubscribe = observer.subscribe(() => undefined);

		try {
			await Promise.resolve();
			expect(observer.getCurrentResult().data?.pages[0]?.items[0]?.id).toBe("hydrated");
			expect(list).not.toHaveBeenCalled();

			focusManager.setFocused(false);
			focusManager.setFocused(true);

			await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
		} finally {
			unsubscribe();
			browserQueryClient.clear();
			browserQueryClient.unmount();
			focusManager.setFocused(undefined);
		}
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
				filterHost: null,
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
