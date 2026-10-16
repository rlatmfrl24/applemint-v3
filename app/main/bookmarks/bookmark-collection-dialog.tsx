"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	BookmarkCollectionPicker,
	bookmarkFieldClass,
} from "@/components/bookmark-collection-picker";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { BookmarkCollection } from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import { canReparentCollection } from "@/lib/bookmark-tree";
import { useTRPCClient } from "@/trpc/client";
import { useCollectionChange } from "./use-bookmark-actions";

export type CollectionDialogSelection = {
	parentId: string | null;
	trigger: HTMLElement | null;
} & (
	| { mode: "create"; collection?: never }
	| { mode: "rename" | "remove" | "move"; collection: BookmarkCollection }
);
const titles = {
	create: "컬렉션 생성",
	rename: "컬렉션 이름 수정",
	remove: "컬렉션 삭제",
	move: "컬렉션 이동",
};
const buttons = { create: "저장", rename: "저장", remove: "삭제", move: "이동" };
export function BookmarkCollectionDialog({
	selection,
	collections,
	close,
	removed,
}: {
	selection: CollectionDialogSelection | null;
	collections: BookmarkCollection[];
	close: () => void;
	removed: (id: string) => void;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const change = useCollectionChange();
	const fieldId = useId();
	const returnFocus = useRef<HTMLElement | null>(null);
	const [parent, setParent] = useState("");
	const mode = selection?.mode ?? "create";
	useEffect(() => {
		if (selection) returnFocus.current = selection.trigger;
		if (selection?.mode === "create") setParent(selection.parentId ?? "");
	}, [selection]);
	const mutate = useMutation({
		mutationFn: async (data: FormData) => {
			if (!selection) throw new Error("컬렉션을 다시 선택해주세요.");
			const { mode, collection } = selection;
			if (mode === "create")
				return trpc.bookmarkCollection.create.mutate({
					name: String(data.get("name")),
					parentId: String(data.get("parent")) || null,
				});
			if (mode !== "remove") throw new Error("컬렉션을 다시 선택해주세요.");
			return trpc.bookmarkCollection.remove.mutate({
				id: collection.id,
				version: collection.version,
			});
		},
		onSuccess: async (result) => {
			if ("deletedId" in result) {
				removed(result.deletedId);
				toast.success(
					`컬렉션을 삭제했습니다. 북마크 ${result.movedBookmarks}개는 미분류로, 하위 컬렉션 ${result.reparentedCollections}개는 한 단계 위로 이동했습니다.`
				);
			} else {
				await cache.cancelQueries({ queryKey: ["bookmarks", "collections"] });
				cache.setQueryData<BookmarkCollection[]>(["bookmarks", "collections"], (old) => [
					...(old ?? []).filter((collection) => collection.id !== result.id),
					result,
				]);
				toast.success("컬렉션을 만들었습니다.");
			}
			close();
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
		},
		onError: async (error) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.error(error.message);
		},
	});
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		if (selection?.mode === "rename" || selection?.mode === "move") {
			const { collection } = selection;
			change.mutate(
				{
					id: collection.id,
					version: collection.version,
					...(selection.mode === "rename"
						? ({ kind: "rename", name: String(data.get("name")) } as const)
						: ({
								kind: "reparent",
								parentId: String(data.get("parent")) || null,
							} as const)),
				},
				{ onSuccess: close }
			);
		} else mutate.mutate(data);
	}
	const pending = [mutate.isPending, change.isPending].some(Boolean);
	return (
		<AlertDialog
			open={Boolean(selection)}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<AlertDialogContent
				className="max-h-[85dvh] overflow-y-auto"
				onEscapeKeyDown={(event) => {
					if ((event.target as HTMLElement).closest('[role="tree"]')) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					const trigger = returnFocus.current;
					if (trigger?.isConnected) trigger.focus();
					else document.getElementById("bookmark-collection-add")?.focus();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle className="border-0 p-0 text-lg">{titles[mode]}</AlertDialogTitle>
					<AlertDialogDescription>
						{selection?.mode === "remove"
							? "북마크는 미분류로 보존하고 하위 컬렉션은 한 단계 위로 이동합니다."
							: "컬렉션으로 북마크를 정리하세요."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<form
					key={`${selection?.mode}-${selection?.collection?.id}`}
					className="min-w-0 space-y-4"
					onSubmit={submit}
				>
					{selection?.mode === "remove" ? (
						<p className="break-all text-sm">
							삭제할 컬렉션:{" "}
							<strong>{collectionPath(selection.collection?.id ?? null, collections)}</strong>
						</p>
					) : selection?.mode === "move" ? (
						<div className="space-y-3">
							<p className="break-words text-sm">
								{collectionPath(selection.collection.id, collections)} · 하위 컬렉션도 함께
								이동합니다.
							</p>
							<label htmlFor={`${fieldId}parent`} className="block text-sm">
								상위 컬렉션
							</label>
							<BookmarkCollectionPicker
								id={`${fieldId}parent`}
								name="parent"
								collections={collections.filter((c) =>
									canReparentCollection(selection.collection.id, c.id, collections)
								)}
								defaultValue={selection.collection.parent_id}
								rootLabel="최상위"
								disabled={pending}
							/>
						</div>
					) : (
						<>
							<div>
								<label htmlFor={`${fieldId}name`} className="mb-1 block text-sm">
									컬렉션 이름
								</label>
								<input
									id={`${fieldId}name`}
									name="name"
									className={bookmarkFieldClass}
									required
									maxLength={160}
									defaultValue={selection?.collection?.name ?? ""}
								/>
							</div>
							{selection?.mode === "create" ? (
								<div>
									<label htmlFor={`${fieldId}parent`} className="mb-1 block text-sm">
										상위 컬렉션
									</label>
									<select
										id={`${fieldId}parent`}
										name="parent"
										className={bookmarkFieldClass}
										value={parent}
										onChange={(event) => setParent(event.target.value)}
									>
										<option value="">최상위</option>
										{collections.map((c) => (
											<option key={c.id} value={c.id}>
												{collectionPath(c.id, collections)}
											</option>
										))}
									</select>
								</div>
							) : (
								<p className="text-muted-foreground text-sm">
									상위 컬렉션:{" "}
									{selection?.collection?.parent_id
										? collectionPath(selection.collection.parent_id, collections)
										: "최상위"}
								</p>
							)}
						</>
					)}
					<div className="flex justify-end gap-2">
						<AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
						<Button
							type="submit"
							variant={selection?.mode === "remove" ? "destructive" : "default"}
							disabled={pending}
						>
							{buttons[mode]}
						</Button>
					</div>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
