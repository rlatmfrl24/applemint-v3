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
export function collectionPath(id: string | null, collections: BookmarkCollection[]) {
	const parts: string[] = [];
	const seen = new Set<string>();
	let current = id;
	while (current && !seen.has(current)) {
		seen.add(current);
		const collection = collections.find((collection) => collection.id === current);
		if (!collection) break;
		parts.unshift(collection.name);
		current = collection.parent_id;
	}
	return parts.join(" / ") || "미분류";
}
