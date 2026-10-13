"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronDown, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BookmarkScope } from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import { latestClassificationProposals } from "@/lib/bookmark-proposal";
import { useTRPCClient } from "@/trpc/client";
import {
	BookmarkCollectionDialog,
	type CollectionDialogSelection,
} from "./bookmark-collection-dialog";
import { BookmarkCollectionTree } from "./bookmark-collection-tree";
import { type BookmarkDetailSelection, BookmarkItemDialog } from "./bookmark-item-dialog";
import { BookmarkJobs } from "./bookmark-jobs";
import { BookmarkRow } from "./bookmark-row";

export type BookmarkView = "library" | "review" | "trash" | "activity";
const viewInfo = {
	library: { label: "북마크", path: "/main/bookmarks" },
	review: { label: "검토", path: "/main/bookmarks/review" },
	trash: { label: "휴지통", path: "/main/bookmarks/trash" },
	activity: { label: "작업 기록", path: "/main/bookmarks/activity" },
};
const reviewTypes = {
	all: "전체",
	dead: "죽은 링크",
	unused: "미사용 후보",
	classify: "컬렉션 변경안",
};
function bookmarkLocation(view: BookmarkView, params: { get: (name: string) => string | null }) {
	const rawCollection = params.get("collection") ?? "all";
	const collection = view !== "library" ? "all" : rawCollection === "unfiled" ? "" : rawCollection;
	const pageValue = Number(params.get("page") ?? 1);
	const page = Number.isFinite(pageValue)
		? Math.min(1000000, Math.max(1, Math.floor(pageValue)))
		: 1;
	const rawType = params.get("type") ?? "all";
	const reviewType = (
		Object.hasOwn(reviewTypes, rawType) ? rawType : "all"
	) as keyof typeof reviewTypes;
	return { collection, page, reviewType };
}
function useBookmarkManager(view: BookmarkView) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const params = useSearchParams();
	const { collection, page, reviewType } = bookmarkLocation(view, params);
	const searchParam = params.get("search") ?? "";
	const [search, setSearch] = useState(searchParam);
	const offset = (page - 1) * 100;
	const [selected, setSelected] = useState<string[]>([]);
	const [scope, setScope] = useState<"selected" | "collection" | "all">("selected");
	const [collectionDialog, setCollectionDialog] = useState<CollectionDialogSelection | null>(null);
	const [itemDialog, setItemDialog] = useState<BookmarkDetailSelection | null>(null);
	const filter = {
		state: view === "trash" ? ("trash" as const) : ("library" as const),
		review: view === "review",
		reviewType,
		search: view === "activity" ? "" : search,
		offset: view === "activity" ? 0 : offset,
		limit: view === "activity" ? 1 : 100,
		...(collection === "all" ? {} : { collectionId: collection || null }),
	};
	const query = useQuery({
		queryKey: ["bookmarks", "list", filter],
		queryFn: () => trpc.bookmark.list.query(filter),
		refetchInterval: 5000,
	});
	const collectionQuery = useQuery({
		queryKey: ["bookmarks", "collections"],
		queryFn: () => trpc.bookmarkCollection.list.query(),
		enabled: view !== "activity",
		refetchInterval: 10000,
	});
	const collections = query.data?.collections ?? collectionQuery.data ?? [];
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
			`${viewInfo[view].path}${queryString ? `?${queryString}` : ""}`
		);
		setSelected([]);
	}
	useEffect(() => {
		setSearch(searchParam);
		setSelected([]);
	}, [searchParam]);
	const selectionKey = JSON.stringify([view, collection, page, reviewType]);
	const previousSelectionKey = useRef(selectionKey);
	useEffect(() => {
		if (previousSelectionKey.current !== selectionKey) {
			setSelected([]);
			previousSelectionKey.current = selectionKey;
		}
	}, [selectionKey]);
	const job = useMutation({
		mutationFn: (kind: "check" | "classify" | "review") => {
			const input = selectedScope(scope, collection, selected);
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
	const items = query.data?.items ?? [];
	const selectedItems = items.filter((item) => selected.includes(item.id));
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
			trpc.bookmarkProposal.approve.mutate({
				items: (exclude ? selectedItems.flatMap((item) => item.proposals) : classifications).map(
					(proposal) => ({ id: proposal.id, exclude })
				),
			}),
		onSuccess: async () => {
			setSelected([]);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("선택 제안을 처리했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	const disabled = job.isPending || (scope === "selected" && selected.length === 0);
	return {
		view,
		collection,
		search,
		setSearch,
		page,
		offset,
		reviewType,
		selected,
		setSelected,
		scope,
		setScope,
		collectionDialog,
		setCollectionDialog,
		itemDialog,
		setItemDialog,
		query,
		collections,
		updateURL,
		job,
		items,
		selectedItems,
		classifications,
		bulk,
		proposals,
		disabled,
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
				<div className="relative min-w-0 flex-1">
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
						aria-label="현재 페이지 선택"
						checked={m.items.length > 0 && m.selected.length === m.items.length}
						onChange={(event) =>
							m.setSelected(event.target.checked ? m.items.map((item) => item.id) : [])
						}
					/>
					현재 페이지 선택
				</label>
				<span className="ml-auto font-mono text-muted-foreground">
					{m.query.data?.total.toLocaleString() ?? "…"}개 · 선택 {m.selected.length}개
				</span>
			</div>
			<BulkControls m={m} />
		</>
	);
}
function Results({ m }: { m: Manager }) {
	const view = m.view;
	if (view === "activity") return null;
	const emptyText = {
		library: "표시할 북마크가 없습니다.",
		review: "처리할 검토 결과가 없습니다.",
		trash: "휴지통이 비어 있습니다.",
	};
	return (
		<>
			{m.query.isPending && (
				<p role="status" className="p-4 text-muted-foreground text-sm">
					북마크를 불러오는 중…
				</p>
			)}
			{m.query.error && (
				<p role="alert" className="text-destructive text-sm">
					{m.query.error.message}
				</p>
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
						/>
					))}
				</section>
			)}
			<div className="flex items-center justify-between pt-2">
				<Button
					variant="ghost"
					size="sm"
					disabled={m.page === 1}
					onClick={() => m.updateURL({ page: m.page === 2 ? null : String(m.page - 1) })}
				>
					<ArrowLeft className="mr-1 size-3.5" />
					이전
				</Button>
				<span className="font-mono text-muted-foreground text-xs">
					{m.page} / {Math.max(1, Math.ceil((m.query.data?.total ?? 0) / 100))} 페이지
				</span>
				<Button
					variant="ghost"
					size="sm"
					disabled={m.offset + 100 >= (m.query.data?.total ?? 0)}
					onClick={() => m.updateURL({ page: String(m.page + 1) })}
				>
					다음
					<ArrowRight className="ml-1 size-3.5" />
				</Button>
			</div>
		</>
	);
}
export function BookmarkLibrary({ view = "library" }: { view?: BookmarkView }) {
	const m = useBookmarkManager(view);
	const collectionTitle =
		m.collection === "all" ? "전체 북마크" : collectionPath(m.collection || null, m.collections);
	return (
		<div className="w-full min-w-0 space-y-4">
			<header className="flex items-center justify-between gap-4">
				<h1 className="m-0 font-semibold text-xl tracking-tight">북마크 관리자</h1>
				<span className="text-muted-foreground text-xs">저장 · 검토 · 정리</span>
			</header>
			<nav aria-label="북마크 보기" className="flex items-center gap-1 border-b pb-2">
				{(Object.keys(viewInfo) as BookmarkView[]).map((key) => (
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
					{m.query.error && <p role="alert">{m.query.error.message}</p>}
					<BookmarkJobs jobs={m.query.data?.jobs ?? []} />
				</section>
			) : (
				<div
					className={[
						"grid min-w-0 gap-5",
						view === "library" ? "lg:grid-cols-[230px_minmax(0,1fr)]" : "grid-cols-1",
					].join(" ")}
				>
					{view === "library" && (
						<BookmarkCollectionTree
							collections={m.collections}
							selected={m.collection}
							select={(id) =>
								m.updateURL({ collection: id === "all" ? null : id || "unfiled", page: null })
							}
							manage={m.setCollectionDialog}
						/>
					)}
					<main className="min-w-0 space-y-3">
						{view === "library" && (
							<h2 className="m-0 border-0 p-0 font-medium text-base">{collectionTitle}</h2>
						)}
						<Toolbar m={m} />
						<Results m={m} />
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
