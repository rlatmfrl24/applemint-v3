"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Folder, GripVertical, MoreHorizontal } from "lucide-react";
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
import { healthSummary } from "@/lib/bookmark-health";
import { useTRPCClient } from "@/trpc/client";
import type { BookmarkDetailSelection } from "./bookmark-item-dialog";
import styles from "./bookmark-row.module.css";
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
	const open = useMutation({
		mutationFn: () => trpc.bookmark.open.mutate({ id: item.id }),
		onSuccess: () => cache.invalidateQueries({ queryKey: ["bookmarks"] }),
		onError: (error) => toast.error(error.message),
	});
	const rowPending = change.isPending || selectionDisabled;
	const path = collectionPath(item.collection_id, collections);
	const proposalLabel = item.proposals.some((proposal) => proposal.kind === "classify")
		? "변경안"
		: "근거";
	const health = healthSummary(item);
	const reason = reviewReason(item);
	return (
		<article
			data-bookmark-id={item.id}
			data-view={view}
			data-detail-selected={detailed}
			draggable={view === "library" && !moving && !selectionDisabled}
			onDragStart={(event) => startDrag(event, item)}
			onDragEnd={endDrag}
			className={`relative isolate grid min-h-[72px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 border-b px-3 py-2 text-sm transition-colors duration-150 last:border-b-0 data-[detail-selected=true]:bg-accent data-[detail-selected=true]:hover:bg-accent motion-reduce:transition-none ${styles.row} ${checked ? "bg-accent/60" : "hover:bg-muted/60"}`}
		>
			<label className="relative z-10 -m-3 flex size-11 items-center justify-center">
				<input
					type="checkbox"
					disabled={selectionDisabled}
					className="size-4 accent-teal-600"
					aria-label={`${item.title || item.url} 선택`}
					checked={checked}
					onChange={select}
				/>
			</label>
			<fieldset className={`m-0 min-w-0 border-0 p-0 ${styles.identity}`} aria-label="링크 정보">
				<div className="flex min-w-0 items-center gap-2">
					<h2
						className={`min-w-0 border-0 p-0 font-semibold text-[15px] leading-5 tracking-normal ${styles.title}`}
					>
						<button
							type="button"
							aria-label={`${item.title || item.url} 상세 보기`}
							className="block w-full cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring focus-visible:after:-outline-offset-2"
							onClick={(event) =>
								detail({ id: item.id, mode: "details", trigger: event.currentTarget })
							}
						>
							<span className="line-clamp-2 break-words">{item.title || item.url}</span>
						</button>
					</h2>
					{health && view !== "review" && (
						<span
							title={health.detail}
							data-severity={health.severity}
							className={`shrink-0 text-muted-foreground text-xs ${styles.inlineHealth}`}
						>
							{health.label}
						</span>
					)}
				</div>
				<BookmarkMetadata
					item={item}
					path={path}
					review={view === "review"}
					onOpen={() => open.mutate()}
				/>
				{view !== "review" && <BookmarkRowContext item={item} view={view} reason={reason} />}
			</fieldset>
			{view === "review" && <BookmarkRowContext item={item} view={view} reason={reason} />}
			<fieldset
				className={`relative z-10 m-0 flex min-w-0 shrink-0 items-center gap-1 border-0 p-0 ${styles.actions}`}
				aria-label="항목 정리"
			>
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
							onClick={() => change.mutate({ action: "keep", items: [item] })}
						>
							유지
						</Button>
						<Button
							variant="destructive"
							size="sm"
							disabled={rowPending}
							title="휴지통으로 이동 (실행 취소 가능)"
							onClick={() => change.mutate({ action: "trash", items: [item] })}
						>
							삭제
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
			</fieldset>
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
	const health = healthSummary(item);
	return view === "review" ? (
		<fieldset aria-label="검토 사유" className={`m-0 border-0 p-0 ${styles.reviewContext}`}>
			<span
				className={`inline-flex rounded-md border px-2 py-1 font-medium text-xs ${health?.severity === "danger" ? "border-destructive/30 bg-destructive/10 text-foreground" : "border-border bg-muted/40 text-foreground"}`}
				title={health?.detail}
			>
				{health?.label ??
					(item.proposals.some((proposal) => proposal.kind === "classify")
						? "컬렉션 변경 제안"
						: "미사용 후보")}
			</span>
			<p
				className="m-0 line-clamp-2 break-words text-foreground/70 text-sm leading-5"
				title={reason}
			>
				{reason}
			</p>
		</fieldset>
	) : (
		item.tags.length > 0 && (
			<p className="m-0 hidden truncate text-foreground/70 text-xs leading-4 xl:block">
				{item.tags.join(" · ")}
			</p>
		)
	);
}
function reviewReason(item: BookmarkItem) {
	const dead =
		item.check?.status === "dead" &&
		item.check.bookmark_version === item.version &&
		!item.check.reviewed_at;

	if (dead && item.check) return item.check.reason;
	const summary = healthSummary(item);
	if (item.check?.evidence && summary?.severity !== "neutral")
		return summary?.detail ?? item.check?.reason ?? "판단 불가";
	return (
		item.proposals[0]?.reason ||
		(item.duplicate_count > 0 ? `같은 URL ${item.duplicate_count + 1}개` : "오래된 저장 항목")
	);
}

function BookmarkMetadata({
	item,
	path,
	review,
	onOpen,
}: {
	item: BookmarkItem;
	path: string;
	review: boolean;
	onOpen: () => void;
}) {
	const safe = /^https?:\/\//iu.test(item.url);
	return (
		<div
			className={`${review ? "mt-1 space-y-3" : "mt-0.5 space-y-1"} min-w-0 text-foreground/70 text-xs leading-4`}
		>
			<a
				draggable={false}
				href={safe ? item.url : undefined}
				target="_blank"
				rel="noopener noreferrer"
				aria-disabled={!safe || undefined}
				onClick={safe ? onOpen : undefined}
				title={item.url}
				className="relative z-10 flex min-h-11 pointer-coarse:min-h-11 w-fit min-w-0 max-w-full items-center gap-1.5 rounded-sm text-[13px] underline decoration-muted-foreground/40 underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-0"
			>
				<ExternalLink className="size-3 shrink-0" aria-hidden="true" />
				<span className="truncate">{item.url.replace(/^https?:\/\//iu, "")}</span>
			</a>
			<div
				className={`flex min-w-0 items-center ${review ? "flex-wrap gap-x-3 gap-y-2" : "gap-2"}`}
			>
				<span
					className={`inline-flex min-w-0 max-w-full items-center gap-1 ${review ? "" : "rounded-sm bg-muted px-1.5"}`}
					title={path}
				>
					<Folder className="size-3 shrink-0" aria-hidden="true" />
					<span className="truncate">{path}</span>
				</span>
				<span className={review ? "shrink-0" : "hidden shrink-0 2xl:inline"}>
					{review && "저장 "}
					{new Date(item.saved_at).toLocaleDateString("ko-KR")}
				</span>
				<span className={review ? "shrink-0" : "hidden shrink-0 2xl:inline"}>
					{item.open_count ? `열기 ${item.open_count}회` : "사용 이력 없음"}
				</span>
			</div>
		</div>
	);
}
