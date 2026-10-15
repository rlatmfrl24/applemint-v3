"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import {
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { collectionForHost } from "@/lib/bookmark-host";
import { useTRPCClient } from "@/trpc/client";
import { BookmarkCollectionPicker, bookmarkFieldClass } from "./bookmark-collection-picker";
import { useBookmarkSaveRecommendation } from "./use-bookmark-save-recommendation";

export type Source = { id: string; url: string; title: string };
function savedMessage(result: { existing: boolean; item: { state: string } }) {
	if (!result.existing) return "북마크를 저장했습니다.";
	return result.item.state === "trash"
		? "휴지통에 이미 저장한 URL입니다. 복원할 수 있습니다."
		: "이미 저장한 URL입니다. 기존 북마크를 확인해주세요.";
}
export default function BookmarkSaveForm({
	source,
	close,
	recommendationId,
	returnFocus,
	onSavingChange,
}: {
	source: Source;
	close: () => void;
	recommendationId?: string;
	returnFocus: () => void;
	onSavingChange: (saving: boolean) => void;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const fieldId = useId();
	const titleInput = useRef<HTMLInputElement>(null);
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
						window.location.href = `/main/bookmarks?state=${result.item.state}&search=${encodeURIComponent(result.item.url)}`;
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
		<AlertDialogContent
			className="max-h-[90dvh] overflow-y-auto pb-[max(24px,env(safe-area-inset-bottom))] motion-reduce:animate-none"
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				titleInput.current?.focus();
			}}
			onEscapeKeyDown={(event) => {
				if (save.isPending || (event.target as HTMLElement).closest('[role="tree"]'))
					event.preventDefault();
			}}
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				returnFocus();
			}}
		>
			<AlertDialogHeader>
				<AlertDialogTitle>북마크 저장</AlertDialogTitle>
				<AlertDialogDescription>
					추천한 컬렉션을 확인하고 저장하세요. 수집 글 상태는 유지됩니다.
				</AlertDialogDescription>
			</AlertDialogHeader>
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
					{busy ? (
						<p role="status" className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
							<Loader2
								aria-hidden="true"
								className="size-4 animate-spin motion-reduce:animate-none"
							/>
							저장할 컬렉션을 추천하고 있어요
						</p>
					) : origin ? (
						<p role="status" className="mt-2 text-muted-foreground text-xs">
							{origin}
						</p>
					) : null}
				</div>
				{error && (
					<div role="alert" className="text-destructive text-xs">
						<p className="m-0">{error}</p>
						<p className="m-0">직접 컬렉션을 선택하거나 미분류로 저장할 수 있습니다.</p>
						{recommendation.error && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => void recommendation.refetch()}
							>
								추천 결과 다시 확인
							</Button>
						)}
					</div>
				)}
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
		</AlertDialogContent>
	);
}
