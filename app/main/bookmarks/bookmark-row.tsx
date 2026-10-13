"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useRef } from "react";
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

export function BookmarkRow({
	item,
	collections,
	view,
	checked,
	select,
	detail,
}: {
	item: BookmarkItem;
	collections: BookmarkCollection[];
	view: "library" | "review" | "trash";
	checked: boolean;
	select: () => void;
	detail: (selection: BookmarkDetailSelection) => void;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const menuTrigger = useRef<HTMLButtonElement>(null);
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
	const safe = /^https?:\/\//iu.test(item.url);
	const path = collectionPath(item.collection_id, collections);
	const dead =
		item.check?.status === "dead" &&
		item.check.bookmark_version === item.version &&
		!item.check.reviewed_at;
	const classify = item.proposals.some((proposal) => proposal.kind === "classify");
	const reason = reviewReason(item, dead);
	return (
		<article
			data-bookmark-id={item.id}
			className={`grid min-h-16 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 border-b px-3 py-2 text-sm last:border-b-0 ${checked ? "bg-accent/60" : "hover:bg-muted/35"}`}
		>
			<input
				type="checkbox"
				className="size-4 accent-teal-600"
				aria-label={`${item.title || item.url} 선택`}
				checked={checked}
				onChange={select}
			/>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					<h2 className="min-w-0 truncate border-0 p-0 font-medium text-sm leading-5">
						<button
							type="button"
							className="max-w-full truncate text-left hover:underline focus-visible:outline focus-visible:outline-ring"
							disabled={!safe}
							title={item.title || item.url}
							onClick={() => {
								window.open(item.url, "_blank", "noopener,noreferrer");
								open.mutate();
							}}
						>
							{item.title || item.url}
						</button>
					</h2>
					{dead && <span className="shrink-0 text-destructive text-xs">죽은 링크 의심</span>}
				</div>
				<BookmarkMetadata item={item} path={path} />
				{view === "review" ? (
					<p className="m-0 truncate text-muted-foreground text-xs leading-4" title={reason}>
						{reason}
					</p>
				) : (
					item.tags.length > 0 && (
						<p className="m-0 hidden truncate text-muted-foreground text-xs leading-4 xl:block">
							{item.tags.join(" · ")}
						</p>
					)
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{view === "review" && (
					<>
						<Button
							variant="ghost"
							size="sm"
							disabled={action.isPending}
							onClick={() => action.mutate("keep")}
						>
							유지
						</Button>
						{classify ? (
							<Button
								variant="outline"
								size="sm"
								onClick={(event) =>
									detail({ item, mode: "proposal", trigger: event.currentTarget })
								}
							>
								변경안
							</Button>
						) : (
							<Button
								variant="outline"
								size="sm"
								onClick={(event) =>
									detail({ item, mode: "proposal", trigger: event.currentTarget })
								}
							>
								근거
							</Button>
						)}
					</>
				)}
				{view === "trash" && (
					<Button
						variant="outline"
						size="sm"
						disabled={action.isPending}
						onClick={() => action.mutate("restore")}
					>
						복원
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							ref={menuTrigger}
							variant="ghost"
							size="icon"
							className="size-8"
							aria-label={`${item.title || item.url} 항목 메뉴`}
						>
							<MoreHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
						<DropdownMenuItem
							onSelect={() => detail({ item, mode: "details", trigger: menuTrigger.current })}
						>
							상세
						</DropdownMenuItem>
						{view !== "trash" && (
							<>
								<DropdownMenuItem
									onSelect={() => detail({ item, mode: "edit", trigger: menuTrigger.current })}
								>
									수정
								</DropdownMenuItem>
								<DropdownMenuItem
									className="text-destructive"
									disabled={action.isPending}
									onSelect={() => action.mutate("trash")}
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
function reviewReason(item: BookmarkItem, dead: boolean) {
	if (dead && item.check) return item.check.reason;
	return (
		item.proposals[0]?.reason ||
		(item.duplicate_count > 0 ? `같은 URL ${item.duplicate_count + 1}개` : "오래된 저장 항목")
	);
}

function BookmarkMetadata({ item, path }: { item: BookmarkItem; path: string }) {
	return (
		<div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
			<span className="max-w-[40%] truncate" title={item.url}>
				{item.url.replace(/^https?:\/\//iu, "")}
			</span>
			<span className="truncate" title={path}>
				{path}
			</span>
			{!item.collection_id && item.previous_collection_path && (
				<span className="truncate" title={item.previous_collection_path}>
					이전: {item.previous_collection_path}
				</span>
			)}
			<span className="hidden shrink-0 lg:inline">
				{new Date(item.saved_at).toLocaleDateString("ko-KR")}
			</span>
			<span className="hidden shrink-0 xl:inline">
				{item.open_count ? `열기 ${item.open_count}회` : "사용 이력 없음"}
			</span>
		</div>
	);
}
