"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { bookmarkUrlLimit } from "@/lib/bookmark-links";
import {
	flattenThreadPages,
	type ThreadListFilterParam,
	type ThreadPage,
} from "@/lib/thread-list-contract";
import { threadListOptions } from "@/lib/thread-query-options";
import type { ThreadItemType, ThreadState } from "@/lib/type-defs";
import { useTRPCClient } from "@/trpc/client";
import NoDataBox from "./no-data";
import { ThreadLoading } from "./threads/thread-loading";

const EMPTY_FILTERS: ThreadListFilterParam[] = [];

function bookmarkBatchesByUrl(pages: ThreadPage[] | undefined) {
	const batches = new Map<string, string[]>();
	for (const { items } of pages ?? []) {
		const urls = [
			...new Set(
				items.map(({ url }) => url).filter((url) => url && url.length <= bookmarkUrlLimit)
			),
		];
		for (const url of urls) {
			if (!batches.has(url)) batches.set(url, urls);
		}
	}
	return batches;
}

export function ThreadInfiniteList({
	state,
	filters = EMPTY_FILTERS,
	renderItem,
	loadingCount = 3,
	onInitialLoadSuccess,
	emptyState,
	header,
}: {
	state: ThreadState;
	filters?: ThreadListFilterParam[];
	renderItem: (thread: ThreadItemType, bookmarkUrls: string[] | undefined) => ReactNode;
	loadingCount?: number;
	onInitialLoadSuccess?: () => void | Promise<void>;
	emptyState?: ReactNode;
	header?: ReactNode;
}) {
	const trpc = useTRPCClient();
	const queryClient = useQueryClient();
	const filterType = useMemo(
		() => filters.find((filter) => filter.key === "filterType")?.value ?? null,
		[filters]
	);
	const filterSite = useMemo(
		() => filters.find((filter) => filter.key === "filterSite")?.value ?? null,
		[filters]
	);
	const options = threadListOptions(trpc, { state, limit: 24, filterType, filterSite });
	const query = useInfiniteQuery(options);
	const threads = useMemo(() => flattenThreadPages(query.data?.pages), [query.data?.pages]);
	const inboxWindow = query.data?.pages[0]?.inboxWindow;
	const hasNewItems = inboxWindow?.hasNew === true;
	const isLoadingNewItems = inboxWindow?.cursor === null && query.isFetching;
	const bookmarkBatches = useMemo(
		() => bookmarkBatchesByUrl(query.data?.pages),
		[query.data?.pages]
	);
	const observerRef = useRef<IntersectionObserver | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const initialSuccessHandledRef = useRef(false);

	const handleLoadMore = useCallback(async () => {
		if (!query.hasNextPage || query.isFetching) {
			return;
		}

		await query.fetchNextPage({ cancelRefetch: false });
	}, [query.fetchNextPage, query.hasNextPage, query.isFetching]);

	const showNewItems = () => {
		queryClient.setQueryData(options.queryKey, (data) => {
			if (!data) return data;
			const [first, ...remaining] = data.pages;
			if (!first?.inboxWindow?.hasNew) return data;
			return {
				...data,
				pages: [{ ...first, inboxWindow: { cursor: null, hasNew: true } }, ...remaining],
			};
		});
		void query.refetch();
	};

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

	return (
		<div className="flex w-full flex-col gap-2">
			{header}
			{state === "inbox" && (
				<Card
					className={
						hasNewItems
							? "flex min-h-11 items-center justify-between gap-2 border-teal-300 bg-teal-50 px-3 py-1 shadow-none dark:border-teal-400/80 dark:bg-teal-950/40"
							: "sr-only"
					}
				>
					<div role="status" className="flex min-w-0 items-center gap-2.5">
						{hasNewItems && (
							<>
								<Download
									aria-hidden="true"
									className="size-5 shrink-0 text-teal-700 dark:text-teal-400"
								/>
								<span className="text-sm font-semibold wrap-anywhere">새 글이 도착했어요</span>
							</>
						)}
					</div>
					{hasNewItems && (
						<Button
							type="button"
							size="sm"
							className="shrink-0 bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-400 dark:text-zinc-950 dark:hover:bg-teal-300"
							disabled={isLoadingNewItems}
							aria-busy={isLoadingNewItems}
							onClick={showNewItems}
						>
							새 글 보기
						</Button>
					)}
				</Card>
			)}
			{query.error && !query.data ? (
				<Alert variant="destructive" className="mb-4">
					<AlertCircle className="h-4 w-4" />
					<AlertTitle>에러 발생</AlertTitle>
					<AlertDescription>
						데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
					</AlertDescription>
				</Alert>
			) : null}
			{query.isLoading ? <ThreadLoading count={loadingCount} /> : null}
			{query.data && !hasNewItems && threads.length === 0 ? (emptyState ?? <NoDataBox />) : null}
			{threads.map((thread) => (
				<Fragment key={String(thread.id)}>
					{renderItem(thread, bookmarkBatches.get(thread.url))}
				</Fragment>
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
