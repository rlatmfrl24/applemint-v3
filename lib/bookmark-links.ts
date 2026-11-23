export const bookmarkUrlLimit = 8192;
export type BookmarkAvailability = "available" | "checking" | "saved";

export function isBookmarkUrlLookup(path: string) {
	return path === "bookmark.lookup" || path === "bookmark.savedLinks";
}
