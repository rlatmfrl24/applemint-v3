"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
	bookmarkHistoryPosition,
	guardBookmarkHistory,
	trackBookmarkHistory,
} from "@/lib/bookmark-history";
import {
	bookmarkResultsChanged,
	flattenBookmarkPages,
	nextBookmarkOffset,
	refreshBookmarkResults,
} from "@/lib/bookmark-list";
import {
	projectBookmarkItems,
	projectCollections,
	refreshBookmarkChanges,
} from "@/lib/bookmark-optimistic";
import { latestClassificationProposals } from "@/lib/bookmark-proposal";
import { collectionAncestors } from "@/lib/bookmark-tree";
import { useTRPCClient } from "@/trpc/client";
import {
	BookmarkCollectionDialog,
	type CollectionDialogSelection,
} from "./bookmark-collection-dialog";
import { BookmarkCollectionTree, type BookmarkDrag } from "./bookmark-collection-tree";
import { type BookmarkDetailSelection, BookmarkItemDialog } from "./bookmark-item-dialog";
import { BookmarkJobs } from "./bookmark-jobs";
import styles from "./bookmark-library.module.css";
import { BookmarkListSkeleton } from "./bookmark-loading";
import { BookmarkRow } from "./bookmark-row";
import {
	useBookmarkChange,
	useBookmarkDisplayChanges,
	useCollectionChange,
	useCollectionDisplayChanges,
} from "./use-bookmark-actions";

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
	content: "본문 삭제·변경 의심",
	media: "미디어 소실·일부 실패",
	uncheckable: "접근 제한·판단 불가",
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
	const router = useRouter();
	const { view, collection, reviewType } = bookmarkLocation(screen, params);
	const searchParam = params.get("search") ?? "";
	const linkedBookmark = params.get("bookmark");
	const [search, setSearch] = useState(searchParam);
	const [querySearch, setQuerySearch] = useState(searchParam);
	const [composing, setComposing] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [scope, setScope] = useState<"selected" | "collection" | "all">("selected");
	const [collectionDialog, setCollectionDialog] = useState<CollectionDialogSelection | null>(null);
	const [itemDialog, rawSetItemDialog] = useState<BookmarkDetailSelection | null>(null);
	const linkedPanel = useRef<string | null>(null);
	useEffect(() => {
		if (!linkedBookmark && !linkedPanel.current) return;
		linkedPanel.current = linkedBookmark;
		const selection: BookmarkDetailSelection | null = linkedBookmark
			? { id: linkedBookmark, mode: "details", trigger: null }
			: null;
		if (dirty.current) setPendingDetail({ selection });
		else rawSetItemDialog(selection);
	}, [linkedBookmark]);
	const dirty = useRef(false);
	const historyPosition = useRef(0);
	const editFocus = useRef<HTMLElement | null>(null);
	const setDirty = useCallback((value: boolean) => {
		if (value && !dirty.current) historyPosition.current = bookmarkHistoryPosition();
		if (value && document.activeElement instanceof HTMLElement)
			editFocus.current = document.activeElement;
		dirty.current = value;
	}, []);
	function restoreEditFocus(event: Event) {
		if (dirty.current && editFocus.current?.isConnected) {
			event.preventDefault();
			editFocus.current.focus({ preventScroll: true });
		}
	}
	const [pendingDetail, setPendingDetail] = useState<
		| { selection: BookmarkDetailSelection | null }
		| { href: string }
		| { historyDelta: number }
		| null
	>(null);
	useEffect(() => {
		trackBookmarkHistory();
		historyPosition.current = bookmarkHistoryPosition();
		let restoring: { delta: number } | null = null;
		function guardHistory(event: PopStateEvent) {
			const position = historyPosition.current;
			const nextPosition = bookmarkHistoryPosition();
			if (restoring) {
				event.stopImmediatePropagation();
				if (nextPosition !== position) {
					window.history.go(position - nextPosition);
					return;
				}
				setPendingDetail({ historyDelta: restoring.delta });
				restoring = null;
			} else if (dirty.current && nextPosition !== position) {
				// Popstate cannot be cancelled; restore the existing entry before Next renders the route.
				event.stopImmediatePropagation();
				restoring = { delta: nextPosition - position };
				window.history.go(-restoring.delta);
			} else historyPosition.current = nextPosition;
		}
		function guardNavigation(event: MouseEvent) {
			if (
				!dirty.current ||
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const link =
				event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
			if (
				!link ||
				link.target === "_blank" ||
				link.hasAttribute("download") ||
				link.origin !== window.location.origin
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			setPendingDetail({ href: link.pathname + link.search + link.hash });
		}
		function guardUnload(event: BeforeUnloadEvent) {
			if (dirty.current) event.preventDefault();
		}
		document.addEventListener("click", guardNavigation, true);
		window.addEventListener("beforeunload", guardUnload);
		const unguardHistory = guardBookmarkHistory(guardHistory);
		return () => {
			document.removeEventListener("click", guardNavigation, true);
			window.removeEventListener("beforeunload", guardUnload);
			unguardHistory();
		};
	}, []);
	function setItemDialog(next: BookmarkDetailSelection | null) {
		if (dirty.current) {
			setPendingDetail({ selection: next });
			return;
		}
		applyItemDialog(next);
	}
	function applyItemDialog(next: BookmarkDetailSelection | null) {
		rawSetItemDialog(next);
		if (linkedBookmark && linkedBookmark !== next?.id) {
			linkedPanel.current = null;
			updateURL({ bookmark: null });
		}
	}
	function discardDetail() {
		const returnFocus =
			pendingDetail && "selection" in pendingDetail && pendingDetail.selection === null
				? itemDialog?.trigger
				: null;
		dirty.current = false;
		applyItemDialog(pendingDetail && "selection" in pendingDetail ? pendingDetail.selection : null);
		if (pendingDetail && "href" in pendingDetail) router.push(pendingDetail.href);
		if (pendingDetail && "historyDelta" in pendingDetail)
			window.history.go(pendingDetail.historyDelta);
		setPendingDetail(null);
		if (returnFocus) requestAnimationFrame(() => returnFocus.isConnected && returnFocus.focus());
	}

	const [dragged, setDragged] = useState<BookmarkDrag | null>(null);
	const filter = {
		state: view === "trash" ? ("trash" as const) : ("library" as const),
		review: view === "review",
		reviewType,
		search: view === "activity" ? "" : querySearch,
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
	const initialResultsCompared = useRef(false);
	const snapshotJobs = query.data?.pages.at(-1)?.jobs;
	useEffect(() => {
		if (!jobsQuery.data) return;
		const compareSnapshot = !initialResultsCompared.current && snapshotJobs !== undefined;
		const changed = bookmarkResultsChanged(
			compareSnapshot ? snapshotJobs : previousJobs.current,
			jobsQuery.data
		);
		if (compareSnapshot) initialResultsCompared.current = true;
		previousJobs.current = jobsQuery.data;
		if (changed) void refreshBookmarkResults(cache);
	}, [jobsQuery.data, snapshotJobs, cache]);
	const collectionQuery = useQuery({
		queryKey: ["bookmarks", "collections"],
		queryFn: () => trpc.bookmarkCollection.list.query(),
		enabled: view !== "activity",
	});
	const snapshot = query.data?.pages.at(-1);
	const collectionChanges = useCollectionDisplayChanges();
	const collections = projectCollections(
		collectionQuery.data ?? snapshot?.collections ?? [],
		collectionChanges
	);
	const rawItems = useMemo(() => flattenBookmarkPages(query.data?.pages), [query.data?.pages]);
	const displayChanges = useBookmarkDisplayChanges();
	const items = projectBookmarkItems(rawItems, displayChanges, filter);
	const bookmarkChange = useBookmarkChange();
	const collectionChange = useCollectionChange();
	const total = snapshot ? Math.max(0, snapshot.total + items.length - rawItems.length) : undefined;
	async function refresh() {
		try {
			if (displayChanges.length) await refreshBookmarkChanges(cache);
			else await query.refetch();
		} catch {
			toast.error("변경은 저장되었습니다. 최신 목록을 확인하지 못했습니다.");
		}
	}

	const selectedItems = items.filter((item) => selected.includes(item.id));
	const selectedIds = selectedItems.map((item) => item.id);
	useEffect(() => {
		if (!query.data) return;
		const pageIds = new Set(flattenBookmarkPages(query.data.pages).map((item) => item.id));
		setSelected((previous) =>
			previous.every((id) => pageIds.has(id)) ? previous : previous.filter((id) => pageIds.has(id))
		);
	}, [query.data]);
	const updateURL = useCallback(
		(values: Record<string, string | null>) => {
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
		},
		[params, screen]
	);
	const commitSearch = useCallback(
		(value: string) => {
			setQuerySearch(value);
			updateURL({ search: value, page: null });
		},
		[updateURL]
	);
	useEffect(() => {
		setSearch(searchParam);
		setQuerySearch(searchParam);
		setSelected([]);
		setDragged(null);
	}, [searchParam]);
	useEffect(() => {
		if (composing || search === querySearch) return;
		const timer = setTimeout(() => commitSearch(search), 250);
		return () => clearTimeout(timer);
	}, [search, querySearch, composing, commitSearch]);
	const selectionKey = JSON.stringify([view, collection, reviewType, querySearch]);
	const previousSelectionKey = useRef(selectionKey);
	useEffect(() => {
		if (previousSelectionKey.current !== selectionKey) {
			setSelected([]);
			setDragged(null);
			previousSelectionKey.current = selectionKey;
		}
	}, [selectionKey]);
	const job = useMutation({
		mutationFn: async (kind: "check" | "classify" | "review") => {
			const input = selectedScope(scope, collection, selectedIds);
			return kind === "check"
				? trpc.bookmarkCheck.start.mutate(input)
				: trpc.bookmarkAI[kind].mutate(input);
		},
		onSuccess: async (result) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success(
				"queuedCount" in result
					? `새 검사 ${result.queuedCount}개 · 진행 중 ${result.reusedCount}개 재사용`
					: "작업을 등록했습니다. 검토 화면에서 결과를 확인하세요."
			);
		},
		onError: (error) => toast.error(error.message),
	});
	const classifications = latestClassificationProposals(selectedItems);
	const bulk = {
		isPending: bookmarkChange.isPending,
		mutate: (action: "keep" | "trash" | "restore") => {
			const items = selectedItems;
			setSelected([]);
			bookmarkChange.mutate({ action, items });
		},
	};

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
	const move = {
		isPending: bookmarkChange.isPending && bookmarkChange.variables?.action === "move",
		variables: bookmarkChange.variables,
		mutate: (input: Parameters<typeof trpc.bookmarkCollection.moveMany.mutate>[0]) => {
			const items = input.items.map((value) => {
				const item = rawItems.find((item) => item.id === value.id);
				if (!item) throw new Error("목록에서 항목을 다시 선택해주세요.");
				return { ...item, version: value.version };
			});
			setSelected([]);
			bookmarkChange.mutate({ action: "move", items, collectionId: input.collectionId });
		},
	};

	const reparent = {
		mutate: (input: Parameters<typeof trpc.bookmarkCollection.reparent.mutate>[0]) =>
			collectionChange.mutate({ ...input, kind: "reparent" }),
	};
	const reorder = {
		mutate: (input: Parameters<typeof trpc.bookmarkCollection.reorder.mutate>[0]) =>
			collectionChange.mutate({ ...input, kind: "reorder" }),
	};
	const moving =
		collectionChanges.length > 0 ||
		move.isPending ||
		displayChanges.some((change) => change.action === "move");

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
		total,
		displayChanges,
		refresh,
		collection,
		search,
		setSearch,
		setComposing,
		commitSearch,
		setDirty,
		restoreEditFocus,
		pendingDetail,
		setPendingDetail,
		discardDetail,
		collectionQuery,
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
			{m.job.data && "queuedCount" in m.job.data && (
				<p role="status" className="text-xs">
					새 검사 {m.job.data.queuedCount}개 · 진행 중 {m.job.data.reusedCount}개 재사용{" "}
					<Link className="underline" href="/main/bookmarks/activity">
						진행 작업 보기
					</Link>
				</p>
			)}
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
							id: m.selectedItems[0].id,
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
						onCompositionStart={() => m.setComposing(true)}
						onCompositionEnd={() => m.setComposing(false)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing)
								m.commitSearch(event.currentTarget.value);
						}}
						onChange={(event) => {
							m.setSearch(event.target.value);
						}}
					/>
				</div>
				{m.view === "library" && <JobControls m={m} />}
				<Button
					size="icon"
					variant="ghost"
					aria-label="목록 새로고침"
					disabled={m.query.isFetching}
					onClick={() => {
						void m.refresh();
					}}
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
					{m.total?.toLocaleString() ?? "…"}개 · 선택 {m.selected.length}개
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
		<div
			ref={scrollRef}
			className={styles.results}
			data-bookmark-scroll
			aria-busy={m.query.isFetching}
		>
			{m.query.isPending && <BookmarkListSkeleton />}
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
						onClick={() => {
							void m.refresh();
						}}
					>
						다시 불러오기
					</Button>
				</div>
			)}
			{m.query.data && m.items.length === 0 && (
				<div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground text-sm">
					<p className="m-0">
						{m.search
							? "검색 결과가 없습니다."
							: m.collection !== "all" && view === "library"
								? "이 컬렉션에 저장한 북마크가 없습니다."
								: emptyText[view]}
					</p>
					{m.search ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								m.setSearch("");
								m.commitSearch("");
							}}
						>
							검색 초기화
						</Button>
					) : view === "library" ? (
						<>
							<p className="m-0 text-xs">Main·Quick에서 Bookmark를 눌러 추가하세요.</p>
							<Button variant="ghost" size="sm" onClick={() => m.updateURL({ collection: null })}>
								전체 보기
							</Button>
						</>
					) : null}
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
							detailed={m.itemDialog?.id === item.id}
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
								m.moving ||
								m.displayChanges.some((change) =>
									change.items.some((candidate) => candidate.id === item.id)
								) ||
								(!m.selected.includes(item.id) && m.selected.length >= 2000)
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
	const { hasNextPage, error, fetchNextPage } = m.query;
	const isFetching = m.query.isFetching || m.displayChanges.length > 0;
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
						{m.items.length.toLocaleString()} / {m.total?.toLocaleString()}개
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
function CollectionBreadcrumb({ m, title }: { m: Manager; title: string }) {
	const path = [...collectionAncestors(m.collection, m.collections).reverse(), m.collection]
		.map((id) => m.collections.find((c) => c.id === id))
		.filter((c) => c !== undefined);
	return (
		<div>
			<h2
				aria-label={title}
				className="m-0 flex flex-wrap items-center gap-1 break-words border-0 p-0 font-medium text-base"
			>
				{path.length
					? path.map((collection, index) => (
							<span key={collection.id} className="contents">
								{index > 0 && (
									<span aria-hidden="true" className="text-muted-foreground">
										/
									</span>
								)}
								<button
									type="button"
									aria-label={`${collection.name} 컬렉션으로 이동`}
									className="min-h-8 max-w-full break-all rounded px-1 text-left hover:bg-muted focus-visible:outline focus-visible:outline-ring"
									onClick={() => m.updateURL({ collection: collection.id })}
								>
									{collection.name}
								</button>
							</span>
						))
					: title}
			</h2>
			{m.collection !== "all" && (
				<p className="m-0 text-muted-foreground text-xs">현재 컬렉션의 직접 소속 항목</p>
			)}
		</div>
	);
}
function Activity({ m }: { m: Manager }) {
	return (
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
			{m.jobsQuery.isPending ? (
				<p role="status">작업 기록을 불러오는 중…</p>
			) : (
				m.jobsQuery.data && <BookmarkJobs jobs={m.jobsQuery.data} />
			)}
		</section>
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
					<Link
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
					</Link>
				))}
			</nav>
			{view === "activity" ? (
				<Activity m={m} />
			) : (
				<div
					ref={frame}
					data-library={view === "library"}
					data-detail={Boolean(m.itemDialog && m.itemDialog.mode !== "move")}
					className={[styles.frame, "grid min-w-0 gap-5"].join(" ")}
				>
					{view === "library" && (
						<BookmarkCollectionTree
							loading={m.collectionQuery.isPending && m.collections.length === 0}
							error={m.collectionQuery.error?.message}
							retry={() => {
								void m.collectionQuery.refetch();
							}}
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
						{m.view === "library" && <CollectionBreadcrumb m={m} title={collectionTitle} />}
						<Toolbar m={m} />
						{m.query.isFetching && !m.query.isPending && !m.query.isFetchingNextPage && (
							<p role="status" className="m-0 text-muted-foreground text-xs">
								목록 갱신 중…
							</p>
						)}
						{m.moving && (
							<p role="status" className="text-muted-foreground text-xs">
								{m.move.isPending
									? `북마크 ${m.move.variables?.items.length ?? 0}개 이동 중…`
									: "컬렉션 이동 중…"}
							</p>
						)}
						<Results key={m.filterKey} m={m} />
					</main>
					<BookmarkItemDialog
						selection={m.itemDialog}
						collections={m.collections}
						close={() => m.setItemDialog(null)}
						changeMode={(mode) => {
							if (m.itemDialog) m.setItemDialog({ ...m.itemDialog, mode });
						}}
						onDirtyChange={m.setDirty}
					/>
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
			<AlertDialog
				open={Boolean(m.pendingDetail)}
				onOpenChange={(open) => {
					if (!open) m.setPendingDetail(null);
				}}
			>
				<AlertDialogContent onCloseAutoFocus={m.restoreEditFocus}>
					<AlertDialogHeader>
						<AlertDialogTitle>편집 내용을 버릴까요?</AlertDialogTitle>
						<AlertDialogDescription>
							아직 저장하지 않은 변경 내용이 있습니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex justify-end gap-2">
						<AlertDialogCancel>계속 편집</AlertDialogCancel>
						<AlertDialogAction onClick={m.discardDetail}>변경 내용 버리기</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
