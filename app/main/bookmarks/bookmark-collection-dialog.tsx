"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { bookmarkFieldClass } from "@/components/bookmark-save-dialog";
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
import { useTRPCClient } from "@/trpc/client";

export type CollectionDialogSelection = {
	mode: "create" | "rename" | "remove";
	collection?: BookmarkCollection;
	parentId: string | null;
	trigger: HTMLElement | null;
};
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
	const fieldId = useId();
	const returnFocus = useRef<HTMLElement | null>(null);
	const [parent, setParent] = useState("");
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
			if (!collection) throw new Error("컬렉션을 다시 선택해주세요.");
			if (mode === "rename")
				return trpc.bookmarkCollection.rename.mutate({
					id: collection.id,
					version: collection.version,
					name: String(data.get("name")),
				});
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
			} else
				toast.success(
					selection?.mode === "create" ? "컬렉션을 만들었습니다." : "컬렉션 이름을 변경했습니다."
				);
			close();
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
		},
		onError: (error) => toast.error(error.message),
	});
	return (
		<AlertDialog
			open={Boolean(selection)}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<AlertDialogContent
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					const trigger = returnFocus.current;
					if (trigger?.isConnected) trigger.focus();
					else document.getElementById("bookmark-collection-add")?.focus();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle className="border-0 p-0 text-lg">
						{selection?.mode === "remove"
							? "컬렉션 삭제"
							: selection?.mode === "rename"
								? "컬렉션 이름 수정"
								: "컬렉션 생성"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{selection?.mode === "remove"
							? "북마크는 미분류로 보존하고 하위 컬렉션은 한 단계 위로 이동합니다."
							: "컬렉션으로 북마크를 정리하세요."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<form
					key={`${selection?.mode}-${selection?.collection?.id}`}
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						mutate.mutate(new FormData(event.currentTarget));
					}}
				>
					{selection?.mode === "remove" ? (
						<p className="break-words text-sm">
							삭제할 컬렉션:{" "}
							<strong>{collectionPath(selection.collection?.id ?? null, collections)}</strong>
						</p>
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
						<AlertDialogCancel disabled={mutate.isPending}>취소</AlertDialogCancel>
						<Button
							type="submit"
							variant={selection?.mode === "remove" ? "destructive" : "default"}
							disabled={mutate.isPending}
						>
							{selection?.mode === "remove" ? "삭제" : "저장"}
						</Button>
					</div>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
