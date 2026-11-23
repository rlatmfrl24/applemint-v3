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
import { bookmarkItemLocation } from "@/lib/bookmark-list";
import { useTRPCClient } from "@/trpc/client";
import {
	BookmarkCollectionPicker,
	bookmarkPickerActionsClass,
	bookmarkPickerDialogClass,
} from "./bookmark-collection-picker";
import { useBookmarkDialogMotion } from "./use-bookmark-dialog-motion";
import { useBookmarkSaveRecommendation } from "./use-bookmark-save-recommendation";

export type Source = { id: string; url: string; title: string };
type ExistingBookmark = Pick<BookmarkItem, "id" | "url" | "title" | "state">;
const saveFieldClass =
	"min-h-11 w-full min-w-0 rounded-md border bg-background px-2.5 py-1.5 text-base sm:min-h-9 sm:text-sm";
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
			<p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
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
			<div className="min-h-0 overflow-y-auto">{message}</div>
			<div className={bookmarkPickerActionsClass}>
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
	error,
	retry,
}: {
	busy: boolean;
	error?: string;
	retry?: () => void;
}) {
	return (
		<>
			{busy && (
				<p
					role="status"
					className="text-muted-foreground m-0 mt-1.5 flex items-center gap-2 text-xs"
				>
					<Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
					저장할 컬렉션을 추천하고 있어요
				</p>
			)}
			{error && (
				<div role="alert" className="text-destructive mt-2 text-xs">
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
	const cancelButton = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const touchLayout = window.matchMedia?.("(max-width: 639px), (pointer: coarse)").matches;
		(touchLayout ? cancelButton.current : titleInput.current)?.focus({ preventScroll: true });
	}, []);
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
		enterManualMode,
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
		<>
			<form
				id={fieldId}
				className="grid min-h-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 overflow-y-auto overscroll-contain"
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
				<label className="text-sm font-medium" htmlFor={`${fieldId}title`}>
					제목
				</label>
				<input
					className={saveFieldClass}
					id={`${fieldId}title`}
					aria-label="제목 (선택)"
					ref={titleInput}
					maxLength={1000}
					value={title}
					disabled={save.isPending}
					onChange={(event) => changeTitle(event.target.value)}
				/>
				<label className="text-muted-foreground text-sm" htmlFor={`${fieldId}url`}>
					URL
				</label>
				<input
					className={`${saveFieldClass} text-muted-foreground`}
					id={`${fieldId}url`}
					type="url"
					value={source.url}
					title={source.url}
					readOnly
				/>
				<div className="col-span-2 min-w-0 space-y-1">
					<div className="flex items-center gap-2">
						<label className="text-sm font-medium" htmlFor={`${fieldId}collection`}>
							컬렉션
						</label>
						{!busy && origin && (
							<span role="status" className="text-muted-foreground text-xs">
								{origin}
							</span>
						)}
						<Button
							className="ml-auto min-h-11 px-2 sm:h-8 sm:min-h-8"
							type="button"
							variant="ghost"
							size="sm"
							disabled={locked || !config.data?.openrouter}
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
							searchable={false}
							disabled={locked}
							onChange={choose}
						/>
						<RecommendationFeedback
							busy={busy}
							error={error}
							retry={recommendation.error ? () => void recommendation.refetch() : undefined}
						/>
					</div>
				</div>
				{collections.error && (
					<p role="alert" className="text-destructive col-span-2 m-0 text-xs">
						컬렉션을 불러오지 못했습니다. 다시 불러오거나 미분류로 저장할 수 있습니다.
						<Button type="button" size="sm" variant="ghost" onClick={() => void start()}>
							다시 불러오기
						</Button>
					</p>
				)}
				{slow && busy && (
					<Button
						className="col-span-2 justify-self-start"
						type="button"
						variant="outline"
						size="sm"
						onClick={enterManualMode}
					>
						기다리지 않고 직접 선택
					</Button>
				)}
				<label className="text-sm font-medium" htmlFor={`${fieldId}tags`}>
					태그
				</label>
				<input
					className={saveFieldClass}
					id={`${fieldId}tags`}
					aria-label="태그 (쉼표로 구분)"
					name="tags"
					placeholder="쉼표로 구분"
					disabled={save.isPending}
				/>
				<label className="self-start pt-2 text-sm font-medium" htmlFor={`${fieldId}note`}>
					메모
				</label>
				<textarea
					className={`${saveFieldClass} resize-y`}
					id={`${fieldId}note`}
					name="note"
					maxLength={20000}
					rows={2}
					disabled={save.isPending}
				/>
			</form>
			<div className={bookmarkPickerActionsClass}>
				<Button
					ref={cancelButton}
					variant="outline"
					type="button"
					disabled={save.isPending}
					onClick={close}
				>
					취소
				</Button>
				<Button type="submit" form={fieldId} disabled={locked}>
					{save.isPending ? "저장 중…" : "저장"}
				</Button>
			</div>
		</>
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
	const showLookupResult = checking || lookup.isError || Boolean(existing);
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
				className={`${bookmarkPickerDialogClass} animate-none! gap-3 sm:px-5 sm:pt-4 sm:pb-4`}
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
				<AlertDialogHeader className="shrink-0 space-y-1 text-left">
					<AlertDialogTitle className="m-0 border-0 p-0">북마크 저장</AlertDialogTitle>
					<AlertDialogDescription className={showLookupResult ? "m-0 leading-snug" : "sr-only"}>
						{lookupDescription(checking, lookup.error, existing)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{showLookupResult ? (
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
