"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { collectionPath } from "@/lib/bookmark-collection";
import { useTRPCClient } from "@/trpc/client";

export const bookmarkFieldClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
export function BookmarkSaveDialog({
	source,
}: {
	source?: { id: string; url: string; title: string };
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const [open, setOpen] = useState(false);
	const fieldId = useId();
	const collections = useQuery({
		queryKey: ["bookmarks", "collections"],
		queryFn: () => trpc.bookmarkCollection.list.query(),
		enabled: open,
	});
	const save = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmark.save.mutate>[0]) =>
			trpc.bookmark.save.mutate(input),
		onSuccess: async (result) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			setOpen(false);
			toast.success(
				result.existing
					? result.item.state === "trash"
						? "휴지통에 이미 저장한 URL입니다. 복원할 수 있습니다."
						: "이미 저장한 URL입니다. 기존 북마크를 확인해주세요."
					: "북마크를 저장했습니다.",
				{
					action: {
						label: "북마크 보기",
						onClick: () => {
							window.location.href = `/main/bookmarks?state=${result.item.state}&search=${encodeURIComponent(result.item.url)}`;
						},
					},
				}
			);
		},
		onError: (error) => toast.error(error.message),
	});
	return (
		<>
			<Button variant="outline" size="sm" onClick={() => setOpen(true)}>
				<BookmarkPlus className="mr-1 size-3.5" />
				북마크 저장
			</Button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
					<AlertDialogHeader>
						<AlertDialogTitle>북마크 저장</AlertDialogTitle>
						<AlertDialogDescription>
							Applemint에 저장합니다. 제목 수집은 저장 후 진행하며 수집 글 상태는 유지됩니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							save.mutate({
								url: String(data.get("url")),
								title: String(data.get("title")),
								collectionId: String(data.get("collection")) || null,
								tags: String(data.get("tags"))
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
								note: String(data.get("note")),
								threadId: source?.id,
							});
						}}
					>
						<label className="block space-y-1" htmlFor={`${fieldId}url`}>
							<span>URL</span>
							<input
								className={bookmarkFieldClass}
								id={`${fieldId}url`}
								name="url"
								type="url"
								required
								maxLength={8192}
								defaultValue={source?.url}
								readOnly={Boolean(source)}
							/>
						</label>
						<label className="block space-y-1" htmlFor={`${fieldId}title`}>
							<span>제목 (선택)</span>
							<input
								className={bookmarkFieldClass}
								id={`${fieldId}title`}
								name="title"
								maxLength={1000}
								defaultValue={source?.title}
							/>
						</label>
						<label className="block space-y-1" htmlFor={`${fieldId}collection`}>
							<span>컬렉션</span>
							<select className={bookmarkFieldClass} id={`${fieldId}collection`} name="collection">
								<option value="">미분류</option>
								{collections.data?.map((c) => (
									<option key={c.id} value={c.id}>
										{collectionPath(c.id, collections.data ?? [])}
									</option>
								))}
							</select>
						</label>
						<label className="block space-y-1" htmlFor={`${fieldId}tags`}>
							<span>태그 (쉼표로 구분)</span>
							<input className={bookmarkFieldClass} id={`${fieldId}tags`} name="tags" />
						</label>
						<label className="block space-y-1" htmlFor={`${fieldId}note`}>
							<span>메모</span>
							<textarea
								className={bookmarkFieldClass}
								id={`${fieldId}note`}
								name="note"
								maxLength={20000}
								rows={3}
							/>
						</label>
						<div className="flex justify-end gap-2">
							<Button variant="ghost" type="button" onClick={() => setOpen(false)}>
								취소
							</Button>
							<Button type="submit" disabled={save.isPending}>
								{save.isPending ? "저장 중…" : "저장"}
							</Button>
						</div>
					</form>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
