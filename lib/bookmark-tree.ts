import type { BookmarkCollection } from "@/contracts/bookmark.schema";

export function collectionChildren(parent: string | null, collections: BookmarkCollection[]) {
	return collections.filter((collection) => collection.parent_id === parent);
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
