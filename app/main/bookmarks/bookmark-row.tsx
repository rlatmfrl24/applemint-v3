"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, MoreHorizontal, PanelRightOpen } from "lucide-react";
import { type DragEvent, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import { useTRPCClient } from "@/trpc/client";
import type { BookmarkDetailSelection } from "./bookmark-item-dialog";
import { useBookmarkChange } from "./use-bookmark-actions";

export function BookmarkRow({
	item,
	collections,
	view,
	checked,
	detailed,
	select,
	detail,
	startDrag,
	endDrag,
	moving,
	selectionDisabled,
}: {
	item: BookmarkItem;
	collections: BookmarkCollection[];
	view: "library" | "review" | "trash";
	checked: boolean;
	detailed: boolean;
	select: () => void;
	detail: (selection: BookmarkDetailSelection) => void;
	startDrag: (event: DragEvent<HTMLElement>, item: BookmarkItem) => void;
	endDrag: () => void;
	moving: boolean;
	selectionDisabled: boolean;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const change = useBookmarkChange();
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const openingDialog = useRef(false);
	function showDialog(mode: "details" | "edit" | "move") {
		openingDialog.current = true;
		detail({ id: item.id, mode, trigger: menuTrigger.current });
	}
	const action = useMutation({
		mutationFn: (kind: "keep" | "trash" | "restore") =>
			trpc.bookmark[kind].mutate({ id: item.id, version: item.version }),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("항목을 처리했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	const open = useMutation({
		mutationFn: () => trpc.bookmark.open.mutate({ id: item.id }),
		onSuccess: () => cache.invalidateQueries({ queryKey: ["bookmarks"] }),
		onError: (error) => toast.error(error.message),
	});
	const rowPending = action.isPending || selectionDisabled;
	const safe = /^https?:\/\//iu.test(item.url);
	const path = collectionPath(item.collection_id, collections);
	const dead =
		item.check?.status === "dead" &&
		item.check.bookmark_version === item.version &&
		!item.check.reviewed_at;
	const proposalLabel = item.proposals.some((proposal) => proposal.kind === "classify")
		? "변경안"
		: "근거";
	const reason = reviewReason(item, dead);
	return (
		<article
			data-bookmark-id={item.id}
			data-detail-selected={detailed}
			draggable={view === "library" && !moving && !selectionDisabled}
			onDragStart={(event) => startDrag(event, item)}
			onDragEnd={endDrag}
			className={`grid min-h-[72px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 border-b px-3 py-2 text-sm transition-colors duration-150 last:border-b-0 motion-reduce:transition-none ${checked ? "bg-accent/60" : "hover:bg-muted/35"}`}
		>
			<label className="-m-3 flex size-11 items-center justify-center">
				<input
					type="checkbox"
					disabled={selectionDisabled}
					className="size-4 accent-teal-600"
					aria-label={`${item.title || item.url} 선택`}
					checked={checked}
					onChange={select}
				/>
			</label>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					<h2 className="min-w-0 border-0 p-0 font-medium text-sm leading-5">
						<a
							draggable={false}
							href={safe ? item.url : undefined}
							target="_blank"
							rel="noopener noreferrer"
							className="line-clamp-2 break-words text-left hover:underline focus-visible:outline focus-visible:outline-ring"
							title={item.title || item.url}
							onClick={() => open.mutate()}
						>
							{item.title || item.url}
						</a>
					</h2>
					{dead && <span className="shrink-0 text-destructive text-xs">죽은 링크 의심</span>}
				</div>
				<BookmarkMetadata item={item} path={path} />
				<BookmarkRowContext item={item} view={view} reason={reason} />
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{view === "library" && (
					<GripVertical
						className="hidden size-4 text-muted-foreground md:block"
						style={{ cursor: "grab" }}
						aria-hidden="true"
					/>
				)}
				{view === "review" && (
					<>
						<Button
							variant="ghost"
							size="sm"
							disabled={rowPending}
							onClick={() => action.mutate("keep")}
						>
							유지
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={(event) =>
								detail({ id: item.id, mode: "proposal", trigger: event.currentTarget })
							}
						>
							{proposalLabel}
						</Button>
					</>
				)}
				{view === "trash" && (
					<Button
						variant="outline"
						size="sm"
						disabled={rowPending}
						onClick={() => change.mutate({ action: "restore", items: [item] })}
					>
						복원
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					className="size-11 md:size-8"
					aria-label="상세"
					title="북마크 상세"
					onClick={(event) =>
						detail({ id: item.id, mode: "details", trigger: event.currentTarget })
					}
				>
					<PanelRightOpen className="size-4" aria-hidden="true" />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							ref={menuTrigger}
							disabled={selectionDisabled}
							variant="ghost"
							size="icon"
							className="hidden size-8 md:inline-flex"
							aria-label={`${item.title || item.url} 항목 메뉴`}
						>
							<MoreHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						onCloseAutoFocus={(event) => {
							if (openingDialog.current) event.preventDefault();
							openingDialog.current = false;
						}}
					>
						<DropdownMenuItem onSelect={() => showDialog("details")}>상세</DropdownMenuItem>
						{view !== "trash" && (
							<>
								<DropdownMenuItem onSelect={() => showDialog("edit")}>수정</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => showDialog("move")}>컬렉션 이동</DropdownMenuItem>
								<DropdownMenuItem
									className="text-destructive"
									disabled={rowPending}
									onSelect={() => change.mutate({ action: "trash", items: [item] })}
								>
									휴지통 이동
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</article>
	);
}
function BookmarkRowContext({
	item,
	view,
	reason,
}: {
	item: BookmarkItem;
	view: string;
	reason: string;
}) {
	return view === "review" ? (
		<p className="m-0 truncate text-muted-foreground text-xs leading-4" title={reason}>
			{reason}
		</p>
	) : (
		item.tags.length > 0 && (
			<p className="m-0 hidden truncate text-muted-foreground text-xs leading-4 xl:block">
				{item.tags.join(" · ")}
			</p>
		)
	);
}
function reviewReason(item: BookmarkItem, dead: boolean) {
	if (dead && item.check) return item.check.reason;
	return (
		item.proposals[0]?.reason ||
		(item.duplicate_count > 0 ? `같은 URL ${item.duplicate_count + 1}개` : "오래된 저장 항목")
	);
}

function BookmarkMetadata({ item, path }: { item: BookmarkItem; path: string }) {
	return (
		<div className="min-w-0 space-y-0.5 text-muted-foreground text-xs">
			<span className="block truncate" title={item.url}>
				{item.url.replace(/^https?:\/\//iu, "")}
			</span>
			<span className="inline-block max-w-full truncate align-bottom" title={path}>
				{path}
			</span>
			{!item.collection_id && item.previous_collection_path && (
				<span
					className="ml-2 inline-block max-w-full truncate align-bottom"
					title={item.previous_collection_path}
				>
					이전: {item.previous_collection_path}
				</span>
			)}
			<span className="ml-2 hidden shrink-0 2xl:inline">
				{new Date(item.saved_at).toLocaleDateString("ko-KR")}
			</span>
			<span className="ml-2 hidden shrink-0 2xl:inline">
				{item.open_count ? `열기 ${item.open_count}회` : "사용 이력 없음"}
			</span>
		</div>
	);
}
