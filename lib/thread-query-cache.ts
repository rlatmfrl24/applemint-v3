import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { ThreadItemType } from "./type-defs";

export type ThreadTableName = "new-threads" | "quick-save" | "trash";

interface ThreadStatsItem {
	key: string;
	label: string;
	count: number;
}

interface ThreadStats {
	counts: ThreadStatsItem[];
	totalCount?: number;
}

export interface ThreadInfinitePage {
	items: ThreadItemType[];
	nextCursor: string | null;
}

export interface QuerySnapshot<TData = unknown> {
	queryKey: QueryKey;
	data: TData | undefined;
}

const NEW_THREADS_STATS_QUERY_KEY = ["new-threads", "stats"] as const;

export const normalizeThreadId = (value: string | number) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}

	const trimmedValue = String(value).trim();

	if (/^[+-]?\d+$/.test(trimmedValue)) {
		return String(Number.parseInt(trimmedValue, 10));
	}

	return trimmedValue;
};

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
		created_at: thread.created_at ?? new Date().toISOString(),
	};
};

const isNewThreadsInfiniteQueryKey = (queryKey: QueryKey) => {
	return (
		Array.isArray(queryKey) &&
		queryKey.length > 0 &&
		queryKey[0] === "new-threads" &&
		queryKey[queryKey.length - 1] !== "stats"
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
	data: InfiniteData<ThreadInfinitePage>,
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

const prependThreadToInfiniteData = (
	data: InfiniteData<ThreadInfinitePage>,
	thread: ThreadItemType
) => {
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

const removeThreadFromArray = (items: ThreadItemType[] | undefined, threadId: string | number) => {
	if (!items) {
		return items;
	}

	const normalizedId = normalizeThreadId(threadId);
	return items.filter((item) => normalizeThreadId(item.id) !== normalizedId);
};

const prependThreadToArray = (items: ThreadItemType[] | undefined, thread: ThreadItemType) => {
	if (!items) {
		return items;
	}

	return prependThreadToItems(items, thread);
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

const captureNewThreadsRemovalSnapshots = (queryClient: QueryClient, thread: ThreadItemType) => {
	const affectedQueries = queryClient.getQueryCache().findAll({
		predicate: (query) => isNewThreadsInfiniteQueryKey(query.queryKey),
	});

	const snapshots: QuerySnapshot[] = affectedQueries.map((query) => {
		const previousData = query.state.data as InfiniteData<ThreadInfinitePage> | undefined;

		if (previousData) {
			queryClient.setQueryData(
				query.queryKey,
				removeThreadFromInfiniteData(previousData, thread.id)
			);
		}

		return {
			queryKey: query.queryKey,
			data: previousData,
		} satisfies QuerySnapshot<InfiniteData<ThreadInfinitePage>>;
	});

	snapshots.push(updateStatsQuery(queryClient, thread, -1));

	return snapshots;
};

const captureArrayRemovalSnapshot = (
	queryClient: QueryClient,
	sourceTable: Exclude<ThreadTableName, "new-threads">,
	thread: ThreadItemType
) => {
	const sourceQueryKey = [sourceTable] as const;
	const previousData = queryClient.getQueryData<ThreadItemType[]>(sourceQueryKey);

	if (previousData) {
		queryClient.setQueryData(sourceQueryKey, removeThreadFromArray(previousData, thread.id));
	}

	return [
		{
			queryKey: sourceQueryKey,
			data: previousData,
		} satisfies QuerySnapshot<ThreadItemType[]>,
	];
};

const captureNewThreadsInsertSnapshots = (
	queryClient: QueryClient,
	thread: ThreadItemType,
	optimisticThread: ThreadItemType
) => {
	const affectedQueries = queryClient.getQueryCache().findAll({
		predicate: (query) => isNewThreadsInfiniteQueryKey(query.queryKey),
	});

	const snapshots: QuerySnapshot[] = affectedQueries.map((query) => {
		const previousData = query.state.data as InfiniteData<ThreadInfinitePage> | undefined;
		const filterKey =
			Array.isArray(query.queryKey) && typeof query.queryKey[1] === "string"
				? query.queryKey[1]
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
		} satisfies QuerySnapshot<InfiniteData<ThreadInfinitePage>>;
	});

	snapshots.push(updateStatsQuery(queryClient, thread, 1));

	return snapshots;
};

const captureArrayInsertSnapshot = (
	queryClient: QueryClient,
	destinationTable: Exclude<ThreadTableName, "new-threads">,
	optimisticThread: ThreadItemType
) => {
	const destinationQueryKey = [destinationTable] as const;
	const previousData = queryClient.getQueryData<ThreadItemType[]>(destinationQueryKey);

	if (previousData) {
		queryClient.setQueryData(
			destinationQueryKey,
			prependThreadToArray(previousData, optimisticThread)
		);
	}

	return [
		{
			queryKey: destinationQueryKey,
			data: previousData,
		} satisfies QuerySnapshot<ThreadItemType[]>,
	];
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
	const sourceSnapshots =
		sourceTable === "new-threads"
			? captureNewThreadsRemovalSnapshots(queryClient, thread)
			: captureArrayRemovalSnapshot(queryClient, sourceTable, thread);
	const destinationSnapshots =
		destinationTable === "new-threads"
			? captureNewThreadsInsertSnapshots(queryClient, thread, optimisticThread)
			: captureArrayInsertSnapshot(queryClient, destinationTable, optimisticThread);

	return [...sourceSnapshots, ...destinationSnapshots];
};

export const invalidateThreadQueries = async (
	queryClient: QueryClient,
	tables: ThreadTableName[]
) => {
	const uniqueTables = Array.from(new Set(tables));

	for (const table of uniqueTables) {
		if (table === "new-threads") {
			await queryClient.invalidateQueries({
				predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "new-threads",
			});
			continue;
		}

		await queryClient.invalidateQueries({
			queryKey: [table],
		});
	}
};
