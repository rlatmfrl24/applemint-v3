export const bookmarkUrlLimit = 8192;

export function isBookmarkUrlLookup(path: string) {
	return path === "bookmark.lookup" || path === "bookmark.savedLinks";
}
