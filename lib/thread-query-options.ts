import { infiniteQueryOptions, mutationOptions, queryOptions } from "@tanstack/react-query";
import type { ThreadPage } from "./thread-list-contract";
import { threadListQueryKey, threadStatsQueryKey } from "./thread-list-contract";
import type { ThreadItemType, ThreadState, ThreadStats } from "./type-defs";

export interface TransitionThreadInput {
	id: string | number;
	expectedState: ThreadState;
	destinationState: ThreadState;
}

interface ThreadListOptionsInput {
	state: ThreadState;
	limit?: number;
	filterType?: string | null;
}

const parseErrorMessage = async (response: Response, fallback: string) => {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return body && typeof body.error === "string" ? body.error : fallback;
};

export const fetchThreadPage = async ({
	state,
	limit,
	filterType,
	cursor,
	signal,
}: ThreadListOptionsInput & { cursor?: string; signal?: AbortSignal }): Promise<ThreadPage> => {
	const searchParams = new URLSearchParams({ state, limit: String(limit ?? 24) });
	if (cursor) searchParams.set("cursor", cursor);
	if (filterType) searchParams.set("filterType", filterType);

	const response = await fetch(`/api/threads?${searchParams.toString()}`, { signal });
	if (!response.ok) {
		throw new Error(await parseErrorMessage(response, "스레드 목록을 불러오지 못했습니다."));
	}

	return (await response.json()) as ThreadPage;
};

export const threadListOptions = ({
	state,
	limit = 24,
	filterType = null,
}: ThreadListOptionsInput) => {
	const filterKey = filterType ? `filterType:${filterType}` : "";

	return infiniteQueryOptions({
		queryKey: threadListQueryKey(state, filterKey),
		queryFn: ({ pageParam, signal }) =>
			fetchThreadPage({ state, limit, filterType, cursor: pageParam, signal }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 5,
	});
};

const fetchThreadStats = async (
	state: ThreadState,
	filterType: string | null = null,
	signal?: AbortSignal
): Promise<ThreadStats> => {
	const searchParams = new URLSearchParams({ state });
	if (filterType) searchParams.set("filterType", filterType);

	const response = await fetch(`/api/threads/stats?${searchParams.toString()}`, { signal });
	if (!response.ok) {
		throw new Error(await parseErrorMessage(response, "스레드 통계를 불러오지 못했습니다."));
	}

	return (await response.json()) as ThreadStats;
};

export const threadStatsOptions = (state: ThreadState, filterType: string | null = null) =>
	queryOptions({
		queryKey: threadStatsQueryKey(state, filterType),
		queryFn: ({ signal }) => fetchThreadStats(state, filterType, signal),
		staleTime: 1000 * 60 * 5,
	});

const transitionThread = async (input: TransitionThreadInput): Promise<ThreadItemType> => {
	const response = await fetch(`/api/threads/${input.id}/state`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			expectedState: input.expectedState,
			destinationState: input.destinationState,
		}),
	});
	if (!response.ok) {
		throw new Error(await parseErrorMessage(response, "스레드 상태를 변경하지 못했습니다."));
	}

	const body = (await response.json()) as { item: ThreadItemType };
	return body.item;
};

export const transitionThreadOptions = () =>
	mutationOptions({
		mutationFn: transitionThread,
	});

const bulkTrashInbox = async (): Promise<number> => {
	const response = await fetch("/api/threads/bulk-trash", { method: "POST" });
	if (!response.ok) {
		throw new Error(await parseErrorMessage(response, "신규 글을 이동하지 못했습니다."));
	}

	const body = (await response.json()) as { movedCount: number };
	return body.movedCount;
};

export const bulkTrashInboxOptions = () => mutationOptions({ mutationFn: bulkTrashInbox });
