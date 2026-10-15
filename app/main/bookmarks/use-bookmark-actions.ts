"use client";
import {
	skipToken,
	type UseMutationResult,
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import {
	BOOKMARK_CHANGES_KEY,
	type BookmarkChange,
	type CollectionChange,
	projectCollections,
	refreshBookmarkChanges,
} from "@/lib/bookmark-optimistic";
import { useTRPCClient } from "@/trpc/client";

type Command = {
	action: BookmarkChange["action"];
	items: BookmarkItem[];
	collectionId?: string | null;
};
export function useBookmarkDisplayChanges() {
	return (
		useQuery<BookmarkChange[]>({
			queryKey: BOOKMARK_CHANGES_KEY,
			queryFn: skipToken,
			initialData: [],
			enabled: false,
			gcTime: Number.POSITIVE_INFINITY,
		}).data ?? []
	);
}
type ChangeResult =
	| Omit<BookmarkItem, "check" | "proposals" | "last_review" | "duplicate_count">
	| { applied: number };
export function useBookmarkChange() {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const mutation: UseMutationResult<ChangeResult, Error, Command, { id: string }> = useMutation<
		ChangeResult,
		Error,
		Command,
		{ id: string }
	>({
		mutationKey: ["bookmarks", "change"],
		mutationFn: (input: Command) => {
			const items = input.items.map(({ id, version }) => ({ id, version }));
			if (input.action === "move")
				return trpc.bookmarkCollection.moveMany.mutate({
					items,
					collectionId: input.collectionId ?? null,
				});
			if (items.length === 1) return trpc.bookmark[input.action].mutate(items[0]);
			return trpc.bookmark.bulk.mutate({ action: input.action, items });
		},
		onMutate: (input) => {
			if (!input.items.length) throw new Error("변경할 항목이 없습니다.");
			const changes = cache.getQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY) ?? [];
			if (
				changes.some((change) =>
					change.items.some((item) => input.items.some((candidate) => candidate.id === item.id))
				)
			)
				throw new Error("이 항목의 이전 변경을 확인하고 있습니다. 잠시 후 다시 시도해주세요.");
			const id = crypto.randomUUID();
			cache.setQueryData(BOOKMARK_CHANGES_KEY, [...changes, { ...input, id, acknowledged: false }]);
			return { id };
		},
		onSuccess: async (result, input, context) => {
			cache.setQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY, (old) =>
				(old ?? []).map((change) =>
					change.id === context.id ? { ...change, acknowledged: true } : change
				)
			);
			const undo =
				input.action === "trash" && input.items.length === 1 && "version" in result
					? {
							label: "실행 취소",
							onClick: () => {
								cache.setQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY, (old) =>
									(old ?? []).filter((change) => change.id !== context.id)
								);
								mutation.mutate({ action: "restore", items: [{ ...input.items[0], ...result }] });
							},
						}
					: undefined;
			toast.success(
				input.action === "move"
					? `북마크 ${input.items.length}개를 이동했습니다.`
					: input.action === "trash"
						? "휴지통으로 이동했습니다."
						: "북마크를 복원했습니다.",
				{ action: undo }
			);
			try {
				await refreshBookmarkChanges(cache);
			} catch {
				toast.info("변경은 저장되었습니다. 최신 목록을 다시 확인해주세요.");
			}
		},
		onError: async (error, _input, context) => {
			if (context)
				cache.setQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY, (old) =>
					(old ?? []).filter((change) => change.id !== context.id)
				);
			toast.error(error.message);
			try {
				await refreshBookmarkChanges(cache, true);
			} catch {
				toast.info("이전 변경은 저장되었습니다. 최신 목록을 다시 확인해주세요.");
			}
		},
	});
	return mutation;
}

type CollectionCommand = CollectionChange & { version: number; targetVersion?: number };
export function useCollectionDisplayChanges() {
	return useMutationState<CollectionCommand>({
		filters: { mutationKey: ["bookmarks", "collection-change"], status: "pending" },
		select: (mutation) => mutation.state.variables as CollectionCommand,
	});
}
export function useCollectionChange() {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	return useMutation({
		mutationKey: ["bookmarks", "collection-change"],
		mutationFn: (input: CollectionCommand) => {
			if (input.kind === "rename") return trpc.bookmarkCollection.rename.mutate(input);
			if (input.kind === "reparent") return trpc.bookmarkCollection.reparent.mutate(input);
			if (input.targetVersion === undefined) throw new Error("대상 컬렉션 버전이 없습니다.");
			return trpc.bookmarkCollection.reorder.mutate({
				...input,
				targetVersion: input.targetVersion,
			});
		},
		onSuccess: async (result, input) => {
			cache.setQueryData<BookmarkCollection[]>(["bookmarks", "collections"], (old) =>
				projectCollections(old ?? [], [input]).map((collection) =>
					collection.id === result.id ? result : collection
				)
			);
			toast.success("컬렉션 변경을 저장했습니다.");
			try {
				await Promise.all([
					cache.invalidateQueries(
						{ queryKey: ["bookmarks", "collections"] },
						{ throwOnError: true }
					),
					cache.invalidateQueries({ queryKey: ["bookmarks", "list"] }, { throwOnError: true }),
				]);
			} catch {
				toast.info("변경은 저장되었습니다. 최신 컬렉션을 다시 확인해주세요.");
			}
		},
		onError: (error) => {
			toast.error(error.message);
			void cache.invalidateQueries({ queryKey: ["bookmarks", "collections"] });
		},
	});
}
