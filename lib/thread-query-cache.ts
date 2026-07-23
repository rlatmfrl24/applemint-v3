import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import { normalizeThreadId, type ThreadPage } from "./thread-list-contract";
import type { ThreadItemType, ThreadState, ThreadStats } from "./type-defs";

export { normalizeThreadId } from "./thread-list-contract";

export type ThreadInfinitePage = ThreadPage;

export interface QuerySnapshot<TData = unknown> {
	queryKey: QueryKey;
	data: TData | undefined;
}

const isThreadListQueryKey = (queryKey: QueryKey, state?: ThreadState) =>
	Array.isArray(queryKey) &&
	queryKey[0] === "threads" &&
	queryKey[1] === "list" &&
	(state === undefined || queryKey[2] === state);

const isThreadStatsQueryKey = (queryKey: QueryKey, state?: ThreadState) =>
	Array.isArray(queryKey) &&
	queryKey[0] === "threads" &&
	queryKey[1] === "stats" &&
	(state === undefined || queryKey[2] === state);

export const isThreadQueryKeyForStates = (queryKey: QueryKey, states: ThreadState[]) =>
	(isThreadListQueryKey(queryKey) || isThreadStatsQueryKey(queryKey)) &&
	states.includes(queryKey[2] as ThreadState);

const parseFilterKey = (filterKey: string | undefined) => {
	const filters = new Map<string, string>();
	for (const segment of filterKey?.split("|") ?? []) {
		const separatorIndex = segment.indexOf(":");
		if (separatorIndex > 0)
			filters.set(segment.slice(0, separatorIndex), segment.slice(separatorIndex + 1));
	}
	return filters;
};

const matchesThreadFilter = (thread: ThreadItemType, filterKey: string | undefined) => {
	const filterType = parseFilterKey(filterKey).get("filterType");
	return !filterType || thread.type === filterType;
};

const removeThread = (data: InfiniteData<ThreadPage>, threadId: string | number) => {
	const normalizedId = normalizeThreadId(threadId);
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			items: page.items.filter((item) => normalizeThreadId(item.id) !== normalizedId),
		})),
	};
};

const prependThread = (data: InfiniteData<ThreadPage>, thread: ThreadItemType) => {
	if (data.pages.length === 0) {
		return { ...data, pages: [{ items: [thread], nextCursor: null }], pageParams: [undefined] };
	}
	return {
		...data,
		pages: data.pages.map((page, index) =>
			index === 0
				? {
						...page,
						items: [
							thread,
							...page.items.filter(
								(item) => normalizeThreadId(item.id) !== normalizeThreadId(thread.id)
							),
						],
					}
				: page
		),
	};
};

const updateThreadStats = (
	queryClient: QueryClient,
	state: ThreadState,
	thread: ThreadItemType,
	delta: number
) => {
	const queries = queryClient.getQueryCache().findAll({
		predicate: (query) => isThreadStatsQueryKey(query.queryKey, state),
	});

	return queries.map((query) => {
		const previousData = query.state.data as ThreadStats | undefined;
		const filterType = Array.isArray(query.queryKey) ? query.queryKey[3] : null;
		if (
			!previousData ||
			(typeof filterType === "string" && filterType && filterType !== thread.type)
		) {
			return { queryKey: query.queryKey, data: previousData } satisfies QuerySnapshot;
		}

		let matched = false;
		const counts = previousData.counts
			.flatMap((item) => {
				if (item.key !== thread.type) return [item];
				matched = true;
				const count = item.count + delta;
				return count > 0 ? [{ ...item, count }] : [];
			})
			.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
		if (!matched && delta > 0) counts.push({ key: thread.type, label: thread.type, count: delta });

		queryClient.setQueryData<ThreadStats>(query.queryKey, {
			counts,
			totalCount: Math.max(0, previousData.totalCount + delta),
		});
		return { queryKey: query.queryKey, data: previousData } satisfies QuerySnapshot;
	});
};

const updateThreadLists = (
	queryClient: QueryClient,
	state: ThreadState,
	thread: ThreadItemType,
	operation: "remove" | "insert"
) =>
	queryClient
		.getQueryCache()
		.findAll({ predicate: (query) => isThreadListQueryKey(query.queryKey, state) })
		.map((query) => {
			const previousData = query.state.data as InfiniteData<ThreadPage> | undefined;
			const filterKey = Array.isArray(query.queryKey) ? query.queryKey[3] : undefined;
			if (
				previousData &&
				(operation === "remove" || matchesThreadFilter(thread, String(filterKey ?? "")))
			) {
				queryClient.setQueryData(
					query.queryKey,
					operation === "remove"
						? removeThread(previousData, thread.id)
						: prependThread(previousData, thread)
				);
			}
			return { queryKey: query.queryKey, data: previousData } satisfies QuerySnapshot;
		});

export const rollbackSnapshots = (queryClient: QueryClient, snapshots: QuerySnapshot[]) => {
	for (const { queryKey, data } of snapshots) queryClient.setQueryData(queryKey, data);
};

export const applyMoveThreadOptimisticUpdates = (
	queryClient: QueryClient,
	{
		sourceState,
		destinationState,
		thread,
	}: { sourceState: ThreadState; destinationState: ThreadState; thread: ThreadItemType }
) => {
	const optimisticThread: ThreadItemType = {
		...thread,
		state: destinationState,
		state_changed_at: new Date().toISOString(),
	};
	return [
		...updateThreadLists(queryClient, sourceState, thread, "remove"),
		...updateThreadLists(queryClient, destinationState, optimisticThread, "insert"),
		...updateThreadStats(queryClient, sourceState, thread, -1),
		...updateThreadStats(queryClient, destinationState, optimisticThread, 1),
	];
};

export const replaceThreadInCaches = (queryClient: QueryClient, thread: ThreadItemType) => {
	for (const query of queryClient.getQueryCache().findAll({
		predicate: (candidate) => isThreadListQueryKey(candidate.queryKey, thread.state),
	})) {
		const data = query.state.data as InfiniteData<ThreadPage> | undefined;
		if (!data) continue;
		queryClient.setQueryData(query.queryKey, {
			...data,
			pages: data.pages.map((page) => ({
				...page,
				items: page.items.map((item) =>
					normalizeThreadId(item.id) === normalizeThreadId(thread.id) ? thread : item
				),
			})),
		});
	}
};

export const invalidateThreadQueries = async (queryClient: QueryClient, states: ThreadState[]) => {
	for (const state of Array.from(new Set(states))) {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["threads", "list", state] }),
			queryClient.invalidateQueries({ queryKey: ["threads", "stats", state] }),
		]);
	}
};
