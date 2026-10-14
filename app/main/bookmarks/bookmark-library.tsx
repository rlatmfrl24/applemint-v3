"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
	BookmarkCollection,
	BookmarkItem,
	BookmarkJob,
	BookmarkScope,
} from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import {
	bookmarkResultsChanged,
	flattenBookmarkPages,
	nextBookmarkOffset,
} from "@/lib/bookmark-list";
import { latestClassificationProposals } from "@/lib/bookmark-proposal";
import { useTRPCClient } from "@/trpc/client";
import {
	BookmarkCollectionDialog,
	type CollectionDialogSelection,
} from "./bookmark-collection-dialog";
import { BookmarkCollectionTree, type BookmarkDrag } from "./bookmark-collection-tree";
import { type BookmarkDetailSelection, BookmarkItemDialog } from "./bookmark-item-dialog";
import { BookmarkJobs } from "./bookmark-jobs";
import styles from "./bookmark-library.module.css";
import { BookmarkRow } from "./bookmark-row";

export type BookmarkView = "library" | "review" | "trash" | "activity";
const viewInfo = {
	library: { label: "북마크", path: "/main/bookmarks" },
	review: { label: "검토", path: "/main/bookmarks/review" },
	trash: { label: "휴지통", path: "/main/bookmarks" },
	activity: { label: "작업 기록", path: "/main/bookmarks/activity" },
};
const reviewTypes = {
	all: "전체",
	dead: "죽은 링크",
	unused: "미사용 후보",
	classify: "컬렉션 변경안",
};
function bookmarkLocation(screen: BookmarkView, params: { get: (name: string) => string | null }) {
	const view = screen === "library" && params.get("state") === "trash" ? "trash" : screen;
	const rawCollection = params.get("collection") ?? "all";
	const collection =
		view === "trash"
			? "trash"
			: view !== "library"
				? "all"
				: rawCollection === "unfiled"
					? ""
					: rawCollection;
	const rawType = params.get("type") ?? "all";
	const reviewType = (
		Object.hasOwn(reviewTypes, rawType) ? rawType : "all"
	) as keyof typeof reviewTypes;
	return { view, collection, reviewType };
}
function useBookmarkManager(screen: BookmarkView) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const params = useSearchParams();
	const { view, collection, reviewType } = bookmarkLocation(screen, params);
	const searchParam = params.get("search") ?? "";
	const [search, setSearch] = useState(searchParam);
	const [selected, setSelected] = useState<string[]>([]);
	const [scope, setScope] = useState<"selected" | "collection" | "all">("selected");
	const [collectionDialog, setCollectionDialog] = useState<CollectionDialogSelection | null>(null);
	const [itemDialog, setItemDialog] = useState<BookmarkDetailSelection | null>(null);
	const [dragged, setDragged] = useState<BookmarkDrag | null>(null);
	const filter = {
		state: view === "trash" ? ("trash" as const) : ("library" as const),
		review: view === "review",
		reviewType,
		search: view === "activity" ? "" : search,
		limit: view === "activity" ? 1 : 100,
		...(collection === "all" || collection === "trash" ? {} : { collectionId: collection || null }),
	};
	const query = useInfiniteQuery({
		queryKey: ["bookmarks", "list", filter],
		queryFn: ({ pageParam, signal }) =>
			trpc.bookmark.list.query({ ...filter, offset: pageParam }, { signal }),
		initialPageParam: 0,
		getNextPageParam: (last, _pages, offset) =>
			view === "activity" ? undefined : nextBookmarkOffset(last, offset),
		enabled: view !== "activity",
		retry: false,
	});
	const jobsQuery = useQuery({
		queryKey: ["bookmarks", "jobs"],
		queryFn: ({ signal }) => trpc.bookmarkImport.status.query(undefined, { signal }),
		refetchInterval: 5000,
		retry: false,
	});
	const previousJobs = useRef<BookmarkJob[] | undefined>(undefined);
	useEffect(() => {
		if (!jobsQuery.data) return;
		const changed = bookmarkResultsChanged(previousJobs.current, jobsQuery.data);
		previousJobs.current = jobsQuery.data;
		if (changed) void cache.invalidateQueries({ queryKey: ["bookmarks", "list"] });
	}, [jobsQuery.data, cache]);
	const collectionQuery = useQuery({
		queryKey: ["bookmarks", "collections"],
		queryFn: () => trpc.bookmarkCollection.list.query(),
		enabled: view !== "activity",
		refetchInterval: 10000,
	});
	const snapshot = query.data?.pages.at(-1);
	const collections = collectionQuery.data ?? snapshot?.collections ?? [];
	const items = useMemo(() => flattenBookmarkPages(query.data?.pages), [query.data?.pages]);
	const selectedItems = items.filter((item) => selected.includes(item.id));
	const selectedIds = selectedItems.map((item) => item.id);
	useEffect(() => {
		if (!query.data) return;
		const pageIds = new Set(flattenBookmarkPages(query.data.pages).map((item) => item.id));
		setSelected((previous) =>
			previous.every((id) => pageIds.has(id)) ? previous : previous.filter((id) => pageIds.has(id))
		);
	}, [query.data]);
	function updateURL(values: Record<string, string | null>) {
		const next = new URLSearchParams(params.toString());
		for (const [key, value] of Object.entries(values)) {
			if (value === null || value === "") next.delete(key);
			else next.set(key, value);
		}
		const queryString = next.toString();
		window.history.replaceState(
			null,
			"",
			`${viewInfo[screen].path}${queryString ? `?${queryString}` : ""}`
		);
		setSelected([]);
	}
	useEffect(() => {
		setSearch(searchParam);
		setSelected([]);
		setDragged(null);
	}, [searchParam]);
	const selectionKey = JSON.stringify([view, collection, reviewType, search]);
	const previousSelectionKey = useRef(selectionKey);
	useEffect(() => {
		if (previousSelectionKey.current !== selectionKey) {
			setSelected([]);
			setDragged(null);
			previousSelectionKey.current = selectionKey;
		}
	}, [selectionKey]);
	const job = useMutation({
		mutationFn: (kind: "check" | "classify" | "review") => {
			const input = selectedScope(scope, collection, selectedIds);
			return kind === "check"
				? trpc.bookmarkCheck.start.mutate(input)
				: trpc.bookmarkAI[kind].mutate(input);
		},
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("작업을 등록했습니다. 검토 화면에서 결과를 확인하세요.");
		},
		onError: (error) => toast.error(error.message),
	});
	const classifications = latestClassificationProposals(selectedItems);
	const bulk = useMutation({
		mutationFn: (action: "keep" | "trash" | "restore") =>
			trpc.bookmark.bulk.mutate({
				action,
				items: selectedItems.map((item) => ({ id: item.id, version: item.version })),
			}),
		onSuccess: async () => {
			setSelected([]);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("선택 항목을 처리했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	const proposals = useMutation({
		mutationFn: (exclude: boolean) =>
			exclude
				? trpc.bookmarkProposal.excludeBookmarks.mutate({
						items: selectedItems.map(({ id, version }) => ({ id, version })),
					})
				: trpc.bookmarkProposal.approve.mutate({
						items: classifications.map(({ id }) => ({ id })),
					}),
		onSuccess: async () => {
			setSelected([]);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("선택 제안을 처리했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	const disabled = job.isPending || (scope === "selected" && selectedIds.length === 0);
	const move = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkCollection.moveMany.mutate>[0]) =>
			trpc.bookmarkCollection.moveMany.mutate(input),
		onSuccess: async (result) => {
			setSelected([]);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success(`북마크 ${result.applied}개를 이동했습니다.`);
		},
		onError: async (error) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.error(error.message);
		},
	});
	const reparent = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkCollection.reparent.mutate>[0]) =>
			trpc.bookmarkCollection.reparent.mutate(input),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("컬렉션을 이동했습니다.");
		},
		onError: async (error) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.error(error.message);
		},
	});
	const reorder = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkCollection.reorder.mutate>[0]) =>
			trpc.bookmarkCollection.reorder.mutate(input),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("컬렉션 순서를 변경했습니다.");
		},
		onError: async (error) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.error(error.message);
		},
	});
	const moving = move.isPending || reparent.isPending || reorder.isPending;
	function reorderCollection(
		source: BookmarkCollection,
		target: BookmarkCollection,
		position: "before" | "after"
	) {
		if (moving) return;
		setDragged(null);
		reorder.mutate({
			id: source.id,
			version: source.version,
			targetId: target.id,
			targetVersion: target.version,
			position,
		});
	}
	function startDrag(event: DragEvent<HTMLElement>, item: BookmarkItem) {
		if (view !== "library" || moving) {
			event.preventDefault();
			return;
		}
		event.dataTransfer.setData("application/x-applemint-bookmark", item.id);
		event.dataTransfer.effectAllowed = "move";
		setDragged({
			kind: "bookmarks",
			items: selectedIds.includes(item.id) ? selectedItems : [item],
		});
	}
	function moveTo(collectionId: string | null) {
		if (!dragged || moving) return;
		setDragged(null);
		if (dragged.kind === "collection") {
			moveCollection(dragged.collection, collectionId);
			return;
		}
		if (dragged.items.every((item) => item.collection_id === collectionId)) return;
		move.mutate({ items: dragged.items.map(({ id, version }) => ({ id, version })), collectionId });
	}
	function moveCollection(collection: BookmarkCollection, parentId: string | null) {
		if (moving || collection.parent_id === parentId) return;
		reparent.mutate({ id: collection.id, version: collection.version, parentId });
	}
	function startCollectionDrag(event: DragEvent<HTMLElement>, collection: BookmarkCollection) {
		if (moving) {
			event.preventDefault();
			return;
		}
		event.dataTransfer.setData("application/x-applemint-collection", collection.id);
		event.dataTransfer.effectAllowed = "move";
		setDragged({ kind: "collection", collection });
	}
	return {
		view,
		collection,
		search,
		setSearch,
		filterKey: selectionKey,
		reviewType,
		selected: selectedIds,
		setSelected,
		scope,
		setScope,
		collectionDialog,
		setCollectionDialog,
		itemDialog,
		setItemDialog,
		query,
		jobsQuery,
		snapshot,
		collections,
		updateURL,
		job,
		items,
		selectedItems,
		classifications,
		bulk,
		proposals,
		disabled,
		move,
		moving,
		dragged,
		startDrag,
		startCollectionDrag,
		moveCollection,
		reorderCollection,
		endDrag: () => setDragged(null),
		moveTo,
	};
}

type Manager = ReturnType<typeof useBookmarkManager>;
function selectedScope(
	scope: "selected" | "collection" | "all",
	collection: string,
	selected: string[]
): BookmarkScope {
	if (scope === "selected") return { scope: "selected", ids: selected };
	if (scope === "all" || collection === "all") return { scope: "all" };
	return { scope: "collection", collectionId: collection || null };
}
function JobControls({ m }: { m: Manager }) {
	return (
		<>
			<label htmlFor="bookmark-job-scope" className="sr-only">
				작업 범위
			</label>
			<select
				id="bookmark-job-scope"
				className="h-9 max-w-full rounded-md border bg-background px-2 text-xs"
				value={m.scope}
				onChange={(event) => m.setScope(event.target.value as typeof m.scope)}
			>
				<option value="selected">선택 항목 {m.selected.length}개</option>
				<option value="collection">
					{m.collection === "all" ? "전체 북마크" : "현재 컬렉션 직접 소속"}
				</option>
				{m.collection !== "all" && <option value="all">전체 북마크</option>}
			</select>
			<Button
				size="sm"
				variant="outline"
				disabled={m.disabled}
				onClick={() => m.job.mutate("check")}
			>
				링크 검사
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="sm" variant="outline" disabled={m.disabled}>
						AI 정리
						<ChevronDown className="ml-1 size-3" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => m.job.mutate("classify")}>
						AI 컬렉션 분류
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => m.job.mutate("review")}>
						AI 미사용 검토
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
function ProposalControls({ m }: { m: Manager }) {
	if (m.view !== "review" || !m.selectedItems.some((item) => item.proposals.length > 0))
		return null;
	return (
		<>
			<Button
				size="sm"
				variant="outline"
				disabled={m.proposals.isPending || m.classifications.length === 0}
				onClick={() => m.proposals.mutate(false)}
			>
				선택 컬렉션 원안 승인 {m.classifications.length}개
			</Button>
			<Button
				size="sm"
				variant="ghost"
				disabled={m.proposals.isPending}
				onClick={() => m.proposals.mutate(true)}
			>
				선택 제안 제외
			</Button>
			<span className="text-muted-foreground">수정한 변경안은 항목 팝업에서 승인하세요.</span>
		</>
	);
}
function BulkControls({ m }: { m: Manager }) {
	if (m.selected.length === 0) return null;
	const restore = m.view === "trash";
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">
			<span>선택 {m.selected.length}개</span>
			{m.view !== "trash" && (
				<Button
					size="sm"
					variant="outline"
					disabled={m.moving}
					onClick={(event) =>
						m.setItemDialog({
							item: m.selectedItems[0],
							items: m.selectedItems,
							mode: "move",
							trigger: event.currentTarget,
						})
					}
				>
					선택 컬렉션 이동
				</Button>
			)}
			{m.view === "review" && (
				<Button
					size="sm"
					variant="outline"
					disabled={m.bulk.isPending}
					onClick={() => m.bulk.mutate("keep")}
				>
					선택 항목 유지
				</Button>
			)}
			<Button
				size="sm"
				variant={restore ? "outline" : "destructive"}
				disabled={m.bulk.isPending}
				onClick={() => m.bulk.mutate(restore ? "restore" : "trash")}
			>
				{restore ? "선택 항목 복원" : "선택 항목 휴지통 이동"}
			</Button>
			<ProposalControls m={m} />
		</div>
	);
}
function Toolbar({ m }: { m: Manager }) {
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<div className={`${styles.search} relative min-w-0 flex-1`}>
					<Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
					<input
						id="bookmark-search"
						aria-label="북마크 검색"
						className="h-9 w-full rounded-md border bg-background pr-3 pl-9 text-sm"
						placeholder="제목 또는 URL 검색"
						value={m.search}
						onChange={(event) => {
							m.setSearch(event.target.value);
							m.updateURL({ search: event.target.value, page: null });
						}}
					/>
				</div>
				{m.view === "library" && <JobControls m={m} />}
				<Button
					size="icon"
					variant="ghost"
					aria-label="목록 새로고침"
					disabled={m.query.isFetching}
					onClick={() => m.query.refetch()}
				>
					<RefreshCw className="size-4" aria-hidden="true" />
				</Button>
			</div>
			{m.view === "review" && (
				<fieldset className="flex flex-wrap gap-1" aria-label="검토 유형">
					{Object.entries(reviewTypes).map(([key, label]) => (
						<Button
							key={key}
							size="sm"
							variant={m.reviewType === key ? "secondary" : "ghost"}
							aria-pressed={m.reviewType === key}
							onClick={() => m.updateURL({ type: key === "all" ? null : key, page: null })}
						>
							{label}
						</Button>
					))}
					<p className="w-full pt-1 text-muted-foreground text-xs">
						사용 이력이 없으면 과거 사용 여부는 불명입니다. 유지와 컬렉션 변경안 승인은 별도로
						처리합니다.
					</p>
				</fieldset>
			)}
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						className="size-4"
						aria-label="불러온 항목 선택"
						disabled={m.moving}
						checked={m.items.length > 0 && m.selected.length === Math.min(m.items.length, 2000)}
						onChange={(event) =>
							m.setSelected(
								event.target.checked ? m.items.slice(0, 2000).map((item) => item.id) : []
							)
						}
					/>
					불러온 항목 선택{m.items.length > 2000 ? " (최대 2,000개)" : ""}
				</label>
				<span className="ml-auto font-mono text-muted-foreground">
					{m.snapshot?.total.toLocaleString() ?? "…"}개 · 선택 {m.selected.length}개
				</span>
			</div>
			<BulkControls m={m} />
		</>
	);
}
function Results({ m }: { m: Manager }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const view = m.view;
	if (view === "activity") return null;
	const emptyText = {
		library: "표시할 북마크가 없습니다.",
		review: "처리할 검토 결과가 없습니다.",
		trash: "휴지통이 비어 있습니다.",
	};
	return (
		<div ref={scrollRef} className={styles.results} data-bookmark-scroll>
			{m.query.isPending && (
				<p role="status" className="p-4 text-muted-foreground text-sm">
					북마크를 불러오는 중…
				</p>
			)}
			{m.query.error && !m.query.isFetchNextPageError && (
				<div role="alert" className="sticky top-0 z-10 bg-background py-2 text-destructive text-sm">
					<p>
						{m.items.length
							? "목록을 갱신하지 못했습니다. 불러온 목록은 유지됩니다."
							: m.query.error.message}
					</p>
					<Button
						size="sm"
						variant="outline"
						disabled={m.query.isFetching}
						onClick={() => m.query.refetch()}
					>
						다시 불러오기
					</Button>
				</div>
			)}
			{m.query.data && m.items.length === 0 && (
				<div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground text-sm">
					{emptyText[view]}
				</div>
			)}
			{m.items.length > 0 && (
				<section
					aria-label={`${viewInfo[view].label} 목록`}
					className="overflow-hidden rounded-lg border"
				>
					{m.items.map((item) => (
						<BookmarkRow
							key={item.id}
							item={item}
							collections={m.collections}
							view={view}
							checked={m.selected.includes(item.id)}
							select={() =>
								m.setSelected((previous) =>
									previous.includes(item.id)
										? previous.filter((id) => id !== item.id)
										: [...previous, item.id]
								)
							}
							detail={m.setItemDialog}
							startDrag={m.startDrag}
							endDrag={m.endDrag}
							moving={m.moving}
							selectionDisabled={
								m.moving || (!m.selected.includes(item.id) && m.selected.length >= 2000)
							}
						/>
					))}
				</section>
			)}
			{m.items.length > 0 && <BookmarkLoadMore m={m} scrollRef={scrollRef} />}
		</div>
	);
}
function BookmarkLoadMore({
	m,
	scrollRef,
}: {
	m: Manager;
	scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
	const sentinel = useRef<HTMLDivElement>(null);
	const { hasNextPage, isFetching, error, fetchNextPage } = m.query;
	useEffect(() => {
		const target = sentinel.current;
		if (!target || !hasNextPage || isFetching || error) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) void fetchNextPage();
			},
			{ root: scrollRef.current, rootMargin: "240px" }
		);
		observer.observe(target);
		return () => observer.disconnect();
	}, [hasNextPage, isFetching, error, fetchNextPage, scrollRef]);
	return (
		<>
			<div ref={sentinel} className={styles.sentinel} data-testid="bookmark-load-more-sentinel" />
			<div
				className={
					m.query.isFetchNextPageError ? "sticky bottom-0 z-10 border-t bg-background" : undefined
				}
			>
				{m.query.isFetchNextPageError && (
					<p role="alert" className="px-3 pt-2 text-destructive text-sm">
						추가 항목을 불러오지 못했습니다. 불러온 목록은 유지됩니다.
					</p>
				)}
				<div className={styles.loadMore}>
					<span>
						{m.items.length.toLocaleString()} / {m.snapshot?.total.toLocaleString()}개
					</span>
					{hasNextPage ? (
						<Button size="sm" variant="ghost" disabled={isFetching} onClick={() => fetchNextPage()}>
							{m.query.isFetchingNextPage
								? "불러오는 중…"
								: m.query.isFetchNextPageError
									? "다시 불러오기"
									: "더 불러오기"}
						</Button>
					) : (
						<span>목록 끝</span>
					)}
				</div>
			</div>
		</>
	);
}
export function BookmarkLibrary({ view = "library" }: { view?: BookmarkView }) {
	const m = useBookmarkManager(view);
	const frame = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = frame.current;
		if (!element) return;
		const measure = () =>
			element.style.setProperty(
				"--bookmark-frame-top",
				`${element.getBoundingClientRect().top + window.scrollY}px`
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element.parentElement ?? element);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	const collectionTitle =
		m.collection === "all" ? "전체 북마크" : collectionPath(m.collection || null, m.collections);
	return (
		<div className="w-full min-w-0 space-y-4">
			<header className="flex items-center justify-between gap-4">
				<h1 className="m-0 font-semibold text-xl tracking-tight">북마크 관리자</h1>
				<span className="text-muted-foreground text-xs">저장 · 검토 · 정리</span>
			</header>
			<nav aria-label="북마크 보기" className="flex items-center gap-1 border-b pb-2">
				{(["library", "review", "activity"] as const).map((key) => (
					<a
						key={key}
						href={viewInfo[key].path}
						aria-current={view === key ? "page" : undefined}
						className={[
							key === "activity" ? "ml-auto text-xs" : "text-sm",
							"rounded-md px-3 py-2",
							view === key
								? "bg-accent font-medium text-accent-foreground"
								: "text-muted-foreground hover:bg-muted hover:text-foreground",
						].join(" ")}
					>
						{viewInfo[key].label}
					</a>
				))}
			</nav>
			{view === "activity" ? (
				<section aria-label="작업 기록" className="max-w-4xl">
					<p className="mb-4 text-muted-foreground text-sm">
						등록한 작업의 진행과 실패 항목을 확인하고 재개할 수 있습니다.
					</p>
					{m.jobsQuery.error && (
						<div role="alert">
							<p>{m.jobsQuery.error.message}</p>
							<Button
								size="sm"
								variant="outline"
								disabled={m.jobsQuery.isFetching}
								onClick={() => m.jobsQuery.refetch()}
							>
								다시 불러오기
							</Button>
						</div>
					)}
					<BookmarkJobs jobs={m.jobsQuery.data ?? []} />
				</section>
			) : (
				<div
					ref={frame}
					className={[
						styles.frame,
						"grid min-w-0 gap-5",
						view === "library" ? "md:grid-cols-[230px_minmax(0,1fr)]" : "grid-cols-1",
					].join(" ")}
				>
					{view === "library" && (
						<BookmarkCollectionTree
							collections={m.collections}
							selected={m.collection}
							select={(id) =>
								m.updateURL({
									state: id === "trash" ? "trash" : null,
									collection: id === "all" || id === "trash" ? null : id || "unfiled",
									page: null,
								})
							}
							manage={m.setCollectionDialog}
							dragged={m.dragged}
							moving={m.moving}
							move={m.moveTo}
							startDrag={m.startCollectionDrag}
							endDrag={m.endDrag}
							reparent={m.moveCollection}
							reorder={m.reorderCollection}
						/>
					)}
					<main className={`${styles.main} min-w-0 space-y-3`}>
						{m.view === "trash" && (
							<h2 className="m-0 border-0 p-0 font-medium text-base">휴지통</h2>
						)}
						{m.view === "library" && (
							<h2 className="m-0 break-words border-0 p-0 font-medium text-base">
								{collectionTitle}
							</h2>
						)}
						<Toolbar m={m} />
						{m.moving && (
							<p role="status" className="text-muted-foreground text-xs">
								{m.move.isPending
									? `북마크 ${m.move.variables?.items.length ?? 0}개 이동 중…`
									: "컬렉션 이동 중…"}
							</p>
						)}
						<Results key={m.filterKey} m={m} />
					</main>
				</div>
			)}
			<BookmarkCollectionDialog
				selection={m.collectionDialog}
				collections={m.collections}
				close={() => m.setCollectionDialog(null)}
				removed={(id) => {
					if (m.collection === id) m.updateURL({ collection: null, page: null });
				}}
			/>
			<BookmarkItemDialog
				selection={m.itemDialog}
				collections={m.collections}
				close={() => m.setItemDialog(null)}
			/>
		</div>
	);
}
