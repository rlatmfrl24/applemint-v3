"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ThreadItemType } from "@/lib/type-defs";
import NoDataBox from "../no-data";
import { QuickSaveButton } from "./quick-save-button";
import { DefaultThreadItem } from "./thread-item";
import { ThreadLoading } from "./thread-loading";

interface ThreadStatsItem {
	key: string;
	label: string;
	count: number;
}

const TypeStats = ({
	stats,
	selectedType,
	onTypeChange,
}: {
	stats: ThreadStatsItem[] | undefined;
	selectedType: string;
	onTypeChange: (type: string) => void;
}) => {
	const totalCount = stats?.reduce((acc, type) => acc + type.count, 0) ?? 0;

	return (
		<Card className="w-full border-zinc-200/80 shadow-none dark:border-zinc-800">
			<CardHeader className="p-3">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={selectedType}
					onValueChange={(value) => {
						if (!value) return;
						onTypeChange(value);
					}}
				>
					<div className="grid w-full grid-cols-2 gap-2 lg:flex lg:flex-wrap">
						<ToggleGroupItem
							value="all"
							className="flex justify-between gap-2 px-2"
							disabled={!stats}
						>
							<span className="font-medium text-xs sm:text-sm">All</span>
							<Badge className="px-1.5 py-0">{stats ? totalCount : "-"}</Badge>
						</ToggleGroupItem>
						{stats?.map((type) => (
							<ToggleGroupItem
								key={type.key}
								value={type.key}
								className="flex justify-between gap-2 px-2"
							>
								<span className="font-medium text-xs sm:text-sm">{type.label}</span>
								<Badge className="px-1.5 py-0">{type.count}</Badge>
							</ToggleGroupItem>
						))}
					</div>
				</ToggleGroup>
			</CardHeader>
		</Card>
	);
};

const ThreadItems = ({ threads }: { threads: ThreadItemType[] }) => {
	return (
		<div className="flex flex-col gap-2">
			{threads.map((thread) => (
				<DefaultThreadItem
					key={thread.id}
					thread={thread}
					threadName="new-threads"
					extraButtons={<QuickSaveButton thread={thread} />}
				/>
			))}
		</div>
	);
};

export const ThreadList = () => {
	const [selectedType, setSelectedType] = useState("all");

	const filterParams = useMemo(() => {
		const params: { key: string; value: string }[] = [];

		if (selectedType !== "all") {
			if (selectedType.startsWith("issuelink::")) {
				const category = selectedType.split("::")[1] ?? "";
				params.push({ key: "filterType", value: "issuelink" });
				if (category) {
					params.push({ key: "issuelinkCategory", value: category });
				}
			} else {
				params.push({ key: "filterType", value: selectedType });
			}
		}

		return params;
	}, [selectedType]);

	const fetchThreads = useCallback(
		async ({ pageParam }: { pageParam?: string }) => {
			const searchParams = new URLSearchParams({
				limit: "24",
			});

			if (pageParam) {
				searchParams.set("cursor", pageParam);
			}

			for (const { key, value } of filterParams) {
				searchParams.set(key, value);
			}

			const response = await fetch(`/api/new-threads?${searchParams.toString()}`);

			if (!response.ok) {
				throw new Error("신규 스레드 데이터를 불러오지 못했습니다.");
			}

			return (await response.json()) as {
				items: ThreadItemType[];
				nextCursor: string | null;
			};
		},
		[filterParams]
	);

	const fetchStats = useCallback(async () => {
		const response = await fetch("/api/new-threads/stats");

		if (!response.ok) {
			throw new Error("신규 스레드 통계를 불러오지 못했습니다.");
		}

		return (await response.json()) as {
			counts: ThreadStatsItem[];
		};
	}, []);

	const filterKey = useMemo(
		() => filterParams.map(({ key, value }) => `${key}:${value}`).join("|"),
		[filterParams]
	);

	const statsQuery = useQuery({
		queryKey: ["new-threads", "stats"],
		queryFn: fetchStats,
		staleTime: 1000 * 60 * 5,
	});

	const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		useInfiniteQuery({
			queryKey: ["new-threads", filterKey],
			queryFn: ({ pageParam }) => fetchThreads({ pageParam }),
			initialPageParam: undefined as string | undefined,
			getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
			staleTime: 1000 * 30,
			gcTime: 1000 * 60 * 5,
		});

	const threads = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

	const observerRef = useRef<IntersectionObserver | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);

	const handleLoadMore = useCallback(async () => {
		if (!hasNextPage || isFetchingNextPage) {
			return;
		}

		await fetchNextPage();
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	useEffect(() => {
		if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
			return;
		}

		if (observerRef.current) {
			observerRef.current.disconnect();
		}

		observerRef.current = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					handleLoadMore().catch((loadError) => {
						console.error("신규 스레드 추가 로드 실패", loadError);
					});
				}
			});
		});

		const currentObserver = observerRef.current;
		const element = loadMoreRef.current;

		if (element) {
			currentObserver.observe(element);
		}

		return () => {
			currentObserver.disconnect();
		};
	}, [handleLoadMore]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (!selectedType) {
			return;
		}

		window.scrollTo({ top: 0, behavior: "smooth" });
	}, [selectedType]);

	if (error) {
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
		<div className="flex w-full flex-col gap-3">
			{statsQuery.data?.counts && statsQuery.data.counts.length > 0 && (
				<TypeStats
					stats={statsQuery.data.counts}
					selectedType={selectedType}
					onTypeChange={setSelectedType}
				/>
			)}
			{isLoading ? (
				<div className="space-y-4">
					<ThreadLoading />
					<ThreadLoading />
					<ThreadLoading />
				</div>
			) : threads.length === 0 ? (
				<NoDataBox />
			) : (
				<ThreadItems threads={threads} />
			)}
			<div ref={loadMoreRef} className="h-6 w-full" />
			{isFetchingNextPage ? (
				<div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
					<Loader2 className="size-3.5 animate-spin" />
					<span>Loading more</span>
				</div>
			) : null}
		</div>
	);
};
