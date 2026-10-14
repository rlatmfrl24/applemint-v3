import type { BookmarkCollection } from "@/contracts/bookmark.schema";
export function collectionPath(
	id: string | null,
	collections: Pick<BookmarkCollection, "id" | "name" | "parent_id">[]
) {
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
