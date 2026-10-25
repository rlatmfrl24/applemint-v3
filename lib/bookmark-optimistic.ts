import type { QueryClient } from "@tanstack/react-query";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import { collectionChildren } from "./bookmark-tree";
export const BOOKMARK_CHANGES_KEY = ["bookmark-ui-changes"] as const;
export type BookmarkChange = {
	id: string;
	action: "trash" | "restore" | "move" | "keep";
	items: BookmarkItem[];
	collectionId?: string | null;
	acknowledged: boolean;
};
export type CollectionChange =
	| { kind: "rename"; id: string; name: string }
	| { kind: "reparent"; id: string; parentId: string | null }
	| { kind: "reorder"; id: string; targetId: string; position: "before" | "after" };
export function projectBookmarkItems(
	items: BookmarkItem[],
	changes: BookmarkChange[],
	filter: { state?: string; collectionId?: string | null; search?: string; review?: boolean }
) {
	const extras = changes.flatMap((change) =>
		change.action !== "keep" && !filter.search && !filter.review
			? change.items.filter((item) => !items.some((existing) => existing.id === item.id))
			: []
	);
	return [...extras, ...items]
		.filter(
			(item) =>
				!filter.review ||
				!changes.some(
					(change) =>
						change.action === "keep" && change.items.some((candidate) => candidate.id === item.id)
				)
		)
		.map((item) => {
			const change = changes.find((change) =>
				change.items.some((candidate) => candidate.id === item.id)
			);
			if (!change || change.action === "keep") return item;
			if (change.action === "move") return { ...item, collection_id: change.collectionId ?? null };
			return {
				...item,
				state: change.action === "trash" ? ("trash" as const) : ("library" as const),
			};
		})
		.filter(
			(item) =>
				item.state === (filter.state ?? "library") &&
				(!Object.hasOwn(filter, "collectionId") || item.collection_id === filter.collectionId)
		);
}
export function projectCollections(collections: BookmarkCollection[], changes: CollectionChange[]) {
	return changes.reduce((current, change) => {
		if (change.kind === "rename")
			return current.map((c) => (c.id === change.id ? { ...c, name: change.name } : c));
		if (change.kind === "reparent")
			return current.map((c) => (c.id === change.id ? { ...c, parent_id: change.parentId } : c));
		const source = current.find((c) => c.id === change.id);
		const target = current.find((c) => c.id === change.targetId);
		if (!source || !target || source.parent_id !== target.parent_id) return current;
		const siblings = collectionChildren(source.parent_id, current).filter(
			(c) => c.id !== source.id
		);
		const index =
			siblings.findIndex((c) => c.id === target.id) + (change.position === "after" ? 1 : 0);
		siblings.splice(index, 0, source);
		return current.map((c) => {
			const order = siblings.findIndex((s) => s.id === c.id);
			return order >= 0 ? { ...c, sort_order: order } : c;
		});
	}, collections);
}
export async function refreshBookmarkChanges(cache: QueryClient, force = false) {
	let needsRefresh = force;
	while (true) {
		const changes = cache.getQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY) ?? [];
		if ((!changes.length && !needsRefresh) || changes.some((change) => !change.acknowledged))
			return;
		await cache.fetchQuery({
			queryKey: ["bookmark-ui-refresh"],
			staleTime: 0,
			gcTime: 0,
			retry: false,
			queryFn: async () => {
				const ids = (cache.getQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY) ?? [])
					.filter((change) => change.acknowledged)
					.map((change) => change.id);
				await Promise.all([
					cache.invalidateQueries(
						{ queryKey: ["bookmarks", "list"], refetchType: "all" },
						{ throwOnError: true }
					),
					cache.invalidateQueries(
						{ queryKey: ["bookmarks", "detail"], refetchType: "all" },
						{ throwOnError: true }
					),
				]);
				cache.setQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY, (old) =>
					(old ?? []).filter((change) => !ids.includes(change.id))
				);
				return true;
			},
		});
		needsRefresh = false;
	}
}
