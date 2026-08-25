"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { flattenThreadPages, type ThreadListFilterParam } from "@/lib/thread-list-contract";
import { threadListOptions } from "@/lib/thread-query-options";
import type { ThreadItemType, ThreadState } from "@/lib/type-defs";
import { useTRPCClient } from "@/trpc/client";
import NoDataBox from "./no-data";
import { ThreadLoading } from "./threads/thread-loading";

const EMPTY_FILTERS: ThreadListFilterParam[] = [];

export function ThreadInfiniteList({
	state,
	filters = EMPTY_FILTERS,
	renderItem,
	loadingCount = 3,
	onInitialLoadSuccess,
	emptyState,
}: {
	state: ThreadState;
	filters?: ThreadListFilterParam[];
	renderItem: (thread: ThreadItemType) => ReactNode;
	loadingCount?: number;
	onInitialLoadSuccess?: () => void | Promise<void>;
	emptyState?: ReactNode;
}) {
	const trpc = useTRPCClient();
	const filterType = useMemo(
		() => filters.find((filter) => filter.key === "filterType")?.value ?? null,
		[filters]
	);
	const filterHost = useMemo(
		() => filters.find((filter) => filter.key === "filterHost")?.value ?? null,
		[filters]
	);
	const query = useInfiniteQuery(
		threadListOptions(trpc, { state, limit: 24, filterType, filterHost })
	);
	const threads = useMemo(() => flattenThreadPages(query.data?.pages), [query.data?.pages]);
	const observerRef = useRef<IntersectionObserver | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const initialSuccessHandledRef = useRef(false);

	const handleLoadMore = useCallback(async () => {
		if (!query.hasNextPage || query.isFetchingNextPage) {
			return;
		}

		await query.fetchNextPage();
	}, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

	useEffect(() => {
		if (!query.isSuccess || initialSuccessHandledRef.current) return;
		initialSuccessHandledRef.current = true;
		Promise.resolve(onInitialLoadSuccess?.()).catch(() => {
			// 호출자가 실패 정책을 결정하며 목록 렌더링은 계속 유지한다.
		});
	}, [onInitialLoadSuccess, query.isSuccess]);

	useEffect(() => {
		if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
			return;
		}

		observerRef.current?.disconnect();
		observerRef.current = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					handleLoadMore().catch((error) => {
						console.error(`${state} 추가 로드 실패`, error);
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
	}, [handleLoadMore, state]);

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
			{!query.isLoading && threads.length === 0 ? (emptyState ?? <NoDataBox />) : null}
			{threads.map((thread) => (
				<Fragment key={String(thread.id)}>{renderItem(thread)}</Fragment>
			))}
			<div ref={loadMoreRef} className="h-6 w-full" data-testid={`${state}-load-more-sentinel`} />
			{query.isFetchingNextPage ? (
				<div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
					<Loader2 className="size-3.5 animate-spin" />
					<span>Loading more</span>
				</div>
			) : null}
		</div>
	);
}
