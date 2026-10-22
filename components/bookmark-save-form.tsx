"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { BookmarkItem } from "@/contracts/bookmark.schema";
import { collectionForHost } from "@/lib/bookmark-host";
import { bookmarkItemLocation } from "@/lib/bookmark-list";
import { useTRPCClient } from "@/trpc/client";
import { BookmarkCollectionPicker, bookmarkFieldClass } from "./bookmark-collection-picker";
import { useBookmarkDialogMotion } from "./use-bookmark-dialog-motion";
import { useBookmarkSaveRecommendation } from "./use-bookmark-save-recommendation";

export type Source = { id: string; url: string; title: string };
type ExistingBookmark = Pick<BookmarkItem, "id" | "url" | "title" | "state">;
function savedMessage(result: { existing: boolean; item: { state: string } }) {
	if (!result.existing) return "북마크를 저장했습니다.";
	return result.item.state === "trash"
		? "휴지통에 이미 저장한 URL입니다. 복원할 수 있습니다."
		: "이미 저장한 URL입니다. 기존 북마크를 확인해주세요.";
}
function lookupDescription(
	checking: boolean,
	error: Error | null,
	existing?: ExistingBookmark | null
) {
	if (checking) return "저장된 북마크가 있는지 먼저 확인합니다.";
	if (error) return "저장 여부를 확인한 후 다시 진행해주세요.";
	if (existing) return savedMessage({ existing: true, item: existing });
	return "추천한 컬렉션을 확인하고 저장하세요. 수집 글 상태는 유지됩니다.";
}
function BookmarkLookupResult({
	checking,
	error,
	existing,
	retry,
	close,
	closeButton,
}: {
	checking: boolean;
	error: Error | null;
	existing?: ExistingBookmark | null;
	retry: () => void;
	close: () => void;
	closeButton: Ref<HTMLButtonElement>;
}) {
	const router = useRouter();
	let message: ReactNode = null;
	if (checking)
		message = (
			<p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
				저장 여부를 확인하고 있어요
			</p>
		);
	else if (error)
		message = (
			<p role="alert" className="text-destructive text-sm">
				{error.message}
			</p>
		);
	else if (existing)
		message = (
			<div className="space-y-2 break-all">
				<p className="font-medium">{existing.title || "제목 없음"}</p>
				<p className="text-muted-foreground text-sm">{existing.url}</p>
				<p className="text-sm">{existing.state === "trash" ? "휴지통" : "북마크에 저장됨"}</p>
			</div>
		);
	return (
		<>
			{message}
			<div className="flex justify-end gap-2">
				<Button ref={closeButton} type="button" variant="ghost" onClick={close}>
					닫기
				</Button>
				{!checking && error && (
					<Button type="button" onClick={retry}>
						다시 확인
					</Button>
				)}
				{!checking && !error && existing && (
					<Button
						type="button"
						onClick={() => {
							close();
							router.push(bookmarkItemLocation(existing));
						}}
					>
						{existing.state === "trash" ? "휴지통에서 보기" : "기존 북마크 보기"}
					</Button>
				)}
			</div>
		</>
	);
}
function RecommendationFeedback({
	busy,
	origin,
	error,
	retry,
}: {
	busy: boolean;
	origin?: string;
	error?: string;
	retry?: () => void;
}) {
	return (
		<>
			{busy ? (
				<p role="status" className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
					<Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
					저장할 컬렉션을 추천하고 있어요
				</p>
			) : origin ? (
				<p role="status" className="mt-2 text-muted-foreground text-xs">
					{origin}
				</p>
			) : null}
			{error && (
				<div role="alert" className="mt-2 text-destructive text-xs">
					<p className="m-0">{error}</p>
					<p className="m-0">직접 컬렉션을 선택하거나 미분류로 저장할 수 있습니다.</p>
					{retry && (
						<Button type="button" size="sm" variant="ghost" onClick={retry}>
							추천 결과 다시 확인
						</Button>
					)}
				</div>
			)}
		</>
	);
}
function BookmarkSaveForm({
	source,
	close,
	recommendationId,
	onSavingChange,
}: {
	source: Source;
	close: () => void;
	recommendationId?: string;
	onSavingChange: (saving: boolean) => void;
}) {
	const trpc = useTRPCClient();
	const router = useRouter();
	const cache = useQueryClient();
	const fieldId = useId();
	const titleInput = useRef<HTMLInputElement>(null);
	useEffect(() => titleInput.current?.focus(), []);
	const {
		collections,
		config,
		title,
		selection,
		jobId,
		applied,
		setApplied,
		message,
		origin,
		busy,
		slow,
		start,
		useManual,
		changeTitle,
		choose,
		recommendation,
	} = useBookmarkSaveRecommendation(source, recommendationId);

	const save = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmark.save.mutate>[0]) =>
			trpc.bookmark.save.mutate(input),
		onSuccess: (result) => {
			close();
			void cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success(savedMessage(result), {
				action: {
					label: "북마크 보기",
					onClick: () => {
						router.push(bookmarkItemLocation(result.item));
					},
				},
			});
		},
		onError: (error) => {
			toast.error(error.message);
			setApplied(undefined);
			void collections.refetch();
		},
	});
	useEffect(() => {
		onSavingChange(save.isPending);
		return () => onSavingChange(false);
	}, [save.isPending, onSavingChange]);
	const locked = save.isPending || busy;
	const error = save.error?.message ?? message ?? recommendation.error?.message;
	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (locked) return;
				const data = new FormData(event.currentTarget);
				save.mutate({
					url: source.url,
					title,
					collectionId: selection.id,
					collectionVersion: selection.version,
					recommendationId: applied,
					tags: String(data.get("tags") ?? "")
						.split(",")
						.map((tag) => tag.trim())
						.filter(Boolean),
					note: String(data.get("note") ?? ""),
					threadId: source.id,
				});
			}}
		>
			<label className="block space-y-1" htmlFor={`${fieldId}url`}>
				<span>URL</span>
				<input
					className={bookmarkFieldClass}
					id={`${fieldId}url`}
					type="url"
					value={source.url}
					readOnly
				/>
			</label>
			<label className="block space-y-1" htmlFor={`${fieldId}title`}>
				<span>제목 (선택)</span>
				<input
					className={bookmarkFieldClass}
					id={`${fieldId}title`}
					ref={titleInput}
					maxLength={1000}
					value={title}
					disabled={save.isPending}
					onChange={(event) => {
						changeTitle(event.target.value);
					}}
				/>
			</label>
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={`${fieldId}collection`}>컬렉션</label>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={
						locked ||
						(!config.data?.openrouter && !collectionForHost(source.url, collections.data ?? []))
					}
					onClick={() => void start(Boolean(jobId || origin))}
				>
					{error && !jobId ? "요청 다시 확인" : "다시 추천"}
				</Button>
			</div>
			<div aria-busy={busy}>
				<BookmarkCollectionPicker
					id={`${fieldId}collection`}
					name="collection"
					collections={collections.data ?? []}
					defaultValue={null}
					value={selection.id}
					disabled={locked}
					onChange={choose}
				/>
				<RecommendationFeedback
					busy={busy}
					origin={origin}
					error={error}
					retry={
						recommendation.error
							? () => {
									void recommendation.refetch();
								}
							: undefined
					}
				/>
			</div>
			{collections.error && (
				<p role="alert" className="text-destructive text-xs">
					컬렉션을 불러오지 못했습니다. 다시 불러오거나 미분류로 저장할 수 있습니다.
					<Button type="button" size="sm" variant="ghost" onClick={() => void start()}>
						다시 불러오기
					</Button>
				</p>
			)}
			{slow && busy && (
				<Button type="button" variant="outline" size="sm" onClick={useManual}>
					기다리지 않고 직접 선택
				</Button>
			)}
			<details className="rounded-md border p-3">
				<summary className="min-h-8 cursor-pointer text-sm">추가 정보 · 태그와 메모</summary>
				<div className="mt-3 space-y-3">
					<label className="block space-y-1" htmlFor={`${fieldId}tags`}>
						<span>태그 (쉼표로 구분)</span>
						<input
							className={bookmarkFieldClass}
							id={`${fieldId}tags`}
							name="tags"
							disabled={save.isPending}
						/>
					</label>
					<label className="block space-y-1" htmlFor={`${fieldId}note`}>
						<span>메모</span>
						<textarea
							className={bookmarkFieldClass}
							id={`${fieldId}note`}
							name="note"
							maxLength={20000}
							rows={3}
							disabled={save.isPending}
						/>
					</label>
				</div>
			</details>
			<div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background pt-3">
				<Button variant="ghost" type="button" disabled={save.isPending} onClick={close}>
					취소
				</Button>
				<Button type="submit" disabled={locked}>
					{save.isPending ? "저장 중…" : "저장"}
				</Button>
			</div>
		</form>
	);
}

export default function BookmarkSaveRoot(props: {
	source: Source;
	recommendationId?: string;
	close: () => void;
	returnFocus: () => void;
	openedAt?: number;
}) {
	const trpc = useTRPCClient();
	const opening = useId();
	const lookup = useQuery({
		queryKey: ["bookmarks", "lookup", props.source.id, props.source.url, opening],
		queryFn: () => trpc.bookmark.lookup.query({ url: props.source.url, threadId: props.source.id }),
		staleTime: 0,
		gcTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
	});
	const checking = lookup.isPending || lookup.isFetching;
	const existing = lookup.data;
	const [saving, setSaving] = useState(false);
	const closeButton = useRef<HTMLButtonElement>(null);
	const { content, overlay, dismiss } = useBookmarkDialogMotion<HTMLDivElement>(
		props.close,
		props.openedAt
	);
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open && !saving) dismiss();
			}}
		>
			<AlertDialogContent
				ref={content}
				overlayRef={overlay}
				overlayClassName="animate-none!"
				className="max-h-[90dvh] animate-none! overflow-y-auto pb-[max(24px,env(safe-area-inset-bottom))]"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					closeButton.current?.focus();
				}}
				onEscapeKeyDown={(event) => {
					if (saving || (event.target as HTMLElement).closest('[role="tree"]'))
						event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					props.returnFocus();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>북마크 저장</AlertDialogTitle>
					<AlertDialogDescription>
						{lookupDescription(checking, lookup.error, existing)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{checking || lookup.isError || existing ? (
					<BookmarkLookupResult
						checking={checking}
						error={lookup.error}
						existing={existing}
						retry={() => void lookup.refetch()}
						close={dismiss}
						closeButton={closeButton}
					/>
				) : (
					<BookmarkSaveForm {...props} close={dismiss} onSavingChange={setSaving} />
				)}
			</AlertDialogContent>
		</AlertDialog>
	);
}
