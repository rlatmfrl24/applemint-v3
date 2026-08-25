import { infiniteQueryOptions, mutationOptions, queryOptions } from "@tanstack/react-query";
import type { TRPCClient } from "@trpc/client";
import type { ThreadTransitionInput } from "@/contracts/thread.schema";
import type { AppRouter } from "@/server/trpc/router";
import {
	createThreadListFilterKey,
	threadListQueryKey,
	threadStatsQueryKey,
} from "./thread-list-contract";
import type { ThreadState } from "./type-defs";

export type TransitionThreadInput = ThreadTransitionInput;
type AppTRPCClient = TRPCClient<AppRouter>;

// 상태 이동 시 여러 list·stats cache를 한 번에 갱신해야 하므로 Thread만 안정적인 수동 key 계층을
// 유지합니다. key/invalidation/rollback 의미는 thread-query-options.test.ts에서 함께 검증합니다.
interface ThreadListOptionsInput {
	state: ThreadState;
	limit?: number;
	filterType?: string | null;
	filterSite?: string | null;
}

export const threadListOptions = (
	trpc: AppTRPCClient,
	{ state, limit = 24, filterType, filterSite }: ThreadListOptionsInput
) => {
	const filterKey = createThreadListFilterKey(filterType, filterSite);

	return infiniteQueryOptions({
		queryKey: threadListQueryKey(state, filterKey),
		queryFn: ({ pageParam, signal }) =>
			trpc.thread.list.query(
				{
					state,
					limit,
					filterType: filterType ?? null,
					filterSite: filterSite ?? null,
					cursor: pageParam ?? null,
				},
				{ signal }
			),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 5,
		refetchOnWindowFocus: "always",
	});
};

export const threadStatsOptions = (
	trpc: AppTRPCClient,
	state: ThreadState,
	filterType: string | null = null
) =>
	queryOptions({
		queryKey: threadStatsQueryKey(state, filterType),
		queryFn: ({ signal }) => trpc.thread.stats.query({ state, filterType }, { signal }),
		staleTime: 1000 * 60 * 5,
		refetchOnWindowFocus: "always",
	});

export const transitionThreadOptions = (trpc: AppTRPCClient) =>
	mutationOptions({
		mutationFn: (input: ThreadTransitionInput) => trpc.thread.transition.mutate(input),
	});

export const bulkTrashInboxOptions = (trpc: AppTRPCClient) =>
	mutationOptions({
		mutationFn: async () => (await trpc.thread.bulkTrash.mutate()).movedCount,
	});
