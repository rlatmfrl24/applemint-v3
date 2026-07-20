"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	flattenThreadPages,
	type ThreadListFilterParam,
	type ThreadPage,
	type ThreadTableName,
	threadListQueryKey,
} from "@/lib/thread-list-contract";
import type { ThreadItemType } from "@/lib/type-defs";
import { ThreadLoading } from "./new-threads/thread-loading";
import NoDataBox from "./no-data";

const EMPTY_FILTERS: ThreadListFilterParam[] = [];

interface FetchThreadPageOptions {
	table: ThreadTableName;
	limit: number;
	cursor?: string;
	filters: ThreadListFilterParam[];
}

export async function fetchThreadPage({
	table,
	limit,
	cursor,
	filters,
}: FetchThreadPageOptions): Promise<ThreadPage> {
	const searchParams = new URLSearchParams({ limit: String(limit) });
	if (cursor) {
		searchParams.set("cursor", cursor);
	}

	for (const { key, value } of filters) {
		searchParams.set(key, value);
	}

	const response = await fetch(`/api/${table}?${searchParams.toString()}`);
	if (!response.ok) {
		throw new Error("스레드 목록을 불러오지 못했습니다.");
	}

	return (await response.json()) as ThreadPage;
}

export function ThreadInfiniteList({
	table,
	filters = EMPTY_FILTERS,
	renderItem,
	loadingCount = 3,
}: {
	table: ThreadTableName;
	filters?: ThreadListFilterParam[];
	renderItem: (thread: ThreadItemType) => ReactNode;
	loadingCount?: number;
}) {
	const filterKey = useMemo(
		() => filters.map(({ key, value }) => `${key}:${value}`).join("|"),
		[filters]
	);
	const query = useInfiniteQuery({
		queryKey: threadListQueryKey(table, filterKey),
		queryFn: ({ pageParam }) =>
			fetchThreadPage({
				table,
				limit: 24,
				cursor: pageParam,
				filters,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 5,
	});
	const threads = useMemo(() => flattenThreadPages(query.data?.pages), [query.data?.pages]);
	const observerRef = useRef<IntersectionObserver | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);

	const handleLoadMore = useCallback(async () => {
		if (!query.hasNextPage || query.isFetchingNextPage) {
			return;
		}

		await query.fetchNextPage();
	}, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

	useEffect(() => {
		if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
			return;
		}

		observerRef.current?.disconnect();
		observerRef.current = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					handleLoadMore().catch((error) => {
						console.error(`${table} 추가 로드 실패`, error);
					});
				}
			}
		});

		const observer = observerRef.current;
		const element = loadMoreRef.current;
		if (element) {
			observer.observe(element);
		}

		return () => {
			observer.disconnect();
		};
	}, [handleLoadMore, table]);

	if (query.error) {
		return (
			<Alert variant="destructive" className="mb-4">
				<AlertCircle className="h-4 w-4" />
				<AlertTitle>에러 발생</AlertTitle>
				<AlertDescription>
					데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="flex w-full flex-col gap-2">
			{query.isLoading ? <ThreadLoading count={loadingCount} /> : null}
			{!query.isLoading && threads.length === 0 ? <NoDataBox /> : null}
			{threads.map((thread) => (
				<Fragment key={String(thread.id)}>{renderItem(thread)}</Fragment>
			))}
			<div ref={loadMoreRef} className="h-6 w-full" />
			{query.isFetchingNextPage ? (
				<div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
					<Loader2 className="size-3.5 animate-spin" />
					<span>Loading more</span>
				</div>
			) : null}
		</div>
	);
}
