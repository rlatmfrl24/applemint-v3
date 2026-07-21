import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import { normalizeThreadId, type ThreadPage, type ThreadTableName } from "./thread-list-contract";
import type { ThreadItemType } from "./type-defs";

export type { ThreadTableName } from "./thread-list-contract";
export { normalizeThreadId } from "./thread-list-contract";

interface ThreadStatsItem {
	key: string;
	label: string;
	count: number;
}

interface ThreadStats {
	counts: ThreadStatsItem[];
	totalCount?: number;
}

export type ThreadInfinitePage = ThreadPage;

export interface QuerySnapshot<TData = unknown> {
	queryKey: QueryKey;
	data: TData | undefined;
}

const NEW_THREADS_STATS_QUERY_KEY = ["new-threads", "stats"] as const;

const getIssuelinkCategory = (thread: ThreadItemType) => {
	return thread.tag?.[1] ?? "unknown";
};

const getThreadStatKey = (thread: ThreadItemType) => {
	if (thread.type === "issuelink") {
		return `issuelink::${getIssuelinkCategory(thread)}`;
	}

	return thread.type;
};

const getThreadStatLabel = (thread: ThreadItemType) => {
	if (thread.type === "issuelink") {
		return getIssuelinkCategory(thread);
	}

	return thread.type;
};

const createOptimisticThread = (thread: ThreadItemType, seed: string): ThreadItemType => {
	return {
		...thread,
		id: `optimistic-${seed}-${normalizeThreadId(thread.id)}`,
		created_at: new Date().toISOString(),
	};
};

const isThreadListQueryKey = (queryKey: QueryKey, table?: ThreadTableName) => {
	return (
		Array.isArray(queryKey) &&
		queryKey.length >= 2 &&
		queryKey[0] === "threads" &&
		(table === undefined || queryKey[1] === table)
	);
};

export const isThreadQueryKeyForTables = (queryKey: QueryKey, tables: ThreadTableName[]) => {
	if (isThreadListQueryKey(queryKey)) {
		return tables.includes(queryKey[1] as ThreadTableName);
	}

	return (
		tables.includes("new-threads") &&
		Array.isArray(queryKey) &&
		queryKey[0] === "new-threads" &&
		queryKey[1] === "stats"
	);
};

const parseFilterKey = (filterKey: string | undefined) => {
	const filters = new Map<string, string>();

	for (const segment of filterKey?.split("|") ?? []) {
		if (!segment) {
			continue;
		}

		const separatorIndex = segment.indexOf(":");
		if (separatorIndex === -1) {
			continue;
		}

		filters.set(segment.slice(0, separatorIndex), segment.slice(separatorIndex + 1));
	}

	return filters;
};

const matchesThreadFilter = (thread: ThreadItemType, filterKey: string | undefined) => {
	if (!filterKey) {
		return true;
	}

	const filters = parseFilterKey(filterKey);
	const filterType = filters.get("filterType");

	if (!filterType) {
		return true;
	}

	if (filterType === "issuelink") {
		if (thread.type !== "issuelink") {
			return false;
		}

		const category = filters.get("issuelinkCategory");
		return !category || getIssuelinkCategory(thread) === category;
	}

	return thread.type === filterType;
};

const removeThreadFromInfiniteData = (
	data: InfiniteData<ThreadPage>,
	threadId: string | number
) => {
	const normalizedId = normalizeThreadId(threadId);
	let removed = false;

	const nextPages = data.pages.map((page) => {
		let pageRemoved = false;

		const filteredItems = page.items.filter((item) => {
			const shouldKeep = normalizeThreadId(item.id) !== normalizedId;
			if (!shouldKeep) {
				pageRemoved = true;
			}
			return shouldKeep;
		});

		if (!pageRemoved) {
			return page;
		}

		removed = true;
		return {
			...page,
			items: filteredItems,
		};
	});

	if (!removed) {
		return data;
	}

	return {
		...data,
		pages: nextPages,
	};
};

const prependThreadToItems = (items: ThreadItemType[], thread: ThreadItemType) => {
	if (items.some((item) => normalizeThreadId(item.id) === normalizeThreadId(thread.id))) {
		return items;
	}

	return [thread, ...items];
};

const prependThreadToInfiniteData = (data: InfiniteData<ThreadPage>, thread: ThreadItemType) => {
	if (data.pages.length === 0) {
		return {
			...data,
			pages: [{ items: [thread], nextCursor: null }],
			pageParams: data.pageParams.length > 0 ? data.pageParams : [undefined],
		};
	}

	return {
		...data,
		pages: data.pages.map((page, index) => {
			if (index !== 0) {
				return page;
			}

			return {
				...page,
				items: prependThreadToItems(page.items, thread),
			};
		}),
	};
};

export const rollbackSnapshots = (queryClient: QueryClient, snapshots: QuerySnapshot[]) => {
	for (const { queryKey, data } of snapshots) {
		queryClient.setQueryData(queryKey, data);
	}
};

const updateStatsQuery = (queryClient: QueryClient, thread: ThreadItemType, delta: number) => {
	const previousData = queryClient.getQueryData<ThreadStats>(NEW_THREADS_STATS_QUERY_KEY);

	if (!previousData) {
		return {
			queryKey: NEW_THREADS_STATS_QUERY_KEY,
			data: previousData,
		} satisfies QuerySnapshot<ThreadStats>;
	}

	const statKey = getThreadStatKey(thread);
	const statLabel = getThreadStatLabel(thread);
	let matched = false;

	const counts = previousData.counts
		.flatMap((item) => {
			if (item.key !== statKey) {
				return [item];
			}

			matched = true;
			const nextCount = item.count + delta;

			if (nextCount <= 0) {
				return [];
			}

			return [{ ...item, count: nextCount }];
		})
		.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

	if (!matched && delta > 0) {
		counts.unshift({
			key: statKey,
			label: statLabel,
			count: delta,
		});
	}

	const currentTotalCount =
		previousData.totalCount ?? previousData.counts.reduce((sum, item) => sum + item.count, 0);

	queryClient.setQueryData<ThreadStats>(NEW_THREADS_STATS_QUERY_KEY, {
		...previousData,
		counts,
		totalCount: Math.max(0, currentTotalCount + delta),
	});

	return {
		queryKey: NEW_THREADS_STATS_QUERY_KEY,
		data: previousData,
	} satisfies QuerySnapshot<ThreadStats>;
};

const captureRemovalSnapshots = (
	queryClient: QueryClient,
	table: ThreadTableName,
	thread: ThreadItemType
) => {
	const affectedQueries = queryClient.getQueryCache().findAll({
		predicate: (query) => isThreadListQueryKey(query.queryKey, table),
	});

	const snapshots: QuerySnapshot[] = affectedQueries.map((query) => {
		const previousData = query.state.data as InfiniteData<ThreadPage> | undefined;

		if (previousData) {
			queryClient.setQueryData(
				query.queryKey,
				removeThreadFromInfiniteData(previousData, thread.id)
			);
		}

		return {
			queryKey: query.queryKey,
			data: previousData,
		} satisfies QuerySnapshot<InfiniteData<ThreadPage>>;
	});

	if (table === "new-threads") {
		snapshots.push(updateStatsQuery(queryClient, thread, -1));
	}

	return snapshots;
};

const captureInsertSnapshots = (
	queryClient: QueryClient,
	table: ThreadTableName,
	thread: ThreadItemType,
	optimisticThread: ThreadItemType
) => {
	const affectedQueries = queryClient.getQueryCache().findAll({
		predicate: (query) => isThreadListQueryKey(query.queryKey, table),
	});

	const snapshots: QuerySnapshot[] = affectedQueries.map((query) => {
		const previousData = query.state.data as InfiniteData<ThreadPage> | undefined;
		const filterKey =
			Array.isArray(query.queryKey) && typeof query.queryKey[2] === "string"
				? query.queryKey[2]
				: undefined;

		if (previousData && matchesThreadFilter(thread, filterKey)) {
			queryClient.setQueryData(
				query.queryKey,
				prependThreadToInfiniteData(previousData, optimisticThread)
			);
		}

		return {
			queryKey: query.queryKey,
			data: previousData,
		} satisfies QuerySnapshot<InfiniteData<ThreadPage>>;
	});

	if (table === "new-threads") {
		snapshots.push(updateStatsQuery(queryClient, thread, 1));
	}

	return snapshots;
};

export const applyMoveThreadOptimisticUpdates = (
	queryClient: QueryClient,
	{
		sourceTable,
		destinationTable,
		thread,
	}: {
		sourceTable: ThreadTableName;
		destinationTable: ThreadTableName;
		thread: ThreadItemType;
	}
) => {
	const optimisticThread = createOptimisticThread(thread, `${sourceTable}-to-${destinationTable}`);
	const sourceSnapshots = captureRemovalSnapshots(queryClient, sourceTable, thread);
	const destinationSnapshots = captureInsertSnapshots(
		queryClient,
		destinationTable,
		thread,
		optimisticThread
	);

	return [...sourceSnapshots, ...destinationSnapshots];
};

export const invalidateThreadQueries = async (
	queryClient: QueryClient,
	tables: ThreadTableName[]
) => {
	const uniqueTables = Array.from(new Set(tables));

	for (const table of uniqueTables) {
		await queryClient.invalidateQueries({
			queryKey: ["threads", table],
		});

		if (table === "new-threads") {
			await queryClient.invalidateQueries({ queryKey: NEW_THREADS_STATS_QUERY_KEY });
		}
	}
};
