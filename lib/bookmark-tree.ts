import type { BookmarkCollection } from "@/contracts/bookmark.schema";

export function collectionChildren(parent: string | null, collections: BookmarkCollection[]) {
	return collections
		.filter((collection) => collection.parent_id === parent)
		.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}
export function collectionDropPosition(offset: number, height: number) {
	if (offset < height / 4) return "before";
	if (offset >= (height * 3) / 4) return "after";
	return "inside";
}
export function collectionAncestors(id: string, collections: BookmarkCollection[]) {
	const result: string[] = [];
	const seen = new Set([id]);
	let current = collections.find((collection) => collection.id === id)?.parent_id;
	while (current && !seen.has(current)) {
		seen.add(current);
		result.push(current);
		current = collections.find((collection) => collection.id === current)?.parent_id;
	}
	return result;
}

export function canReparentCollection(
	id: string,
	parent: string | null,
	collections: BookmarkCollection[]
) {
	return parent !== id && !collectionAncestors(parent ?? "", collections).includes(id);
}
