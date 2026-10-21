import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";

function uiCollection(
	id: string,
	name: string,
	parent_id: string | null = null,
	sort_order = 0
): BookmarkCollection {
	return {
		id,
		name,
		parent_id,
		sort_order,
		version: 1,
		source_id: null,
		original: null,
		created_at: "2026-10-01T00:00:00Z",
	};
}

export const uiCollections = [
	uiCollection("work", "Work"),
	uiCollection("guides", "Guides", "work"),
	uiCollection("react", "React", "guides"),
	uiCollection("notes", "Notes", "work", 1),
	uiCollection("personal", "Personal", null, 1),
];

export function uiBookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
	return {
		id: "bookmark-1",
		url: "https://example.com/guide",
		url_key: "https://example.com/guide",
		title: "React guide",
		description: "A guide to rendering",
		tags: ["react", "reading"],
		note: "Read this later",
		collection_id: "react",
		previous_collection_path: null,
		state: "library",
		version: 3,
		source_id: null,
		source_thread_id: null,
		original: null,
		saved_at: "2026-10-01T00:00:00Z",
		created_at: "2026-10-01T00:00:00Z",
		updated_at: "2026-10-01T00:00:00Z",
		opened_at: null,
		open_count: 0,
		review_revision: 0,
		duplicate_count: 0,
		check: null,
		proposals: [],
		last_review: null,
		...overrides,
	};
}
