import type { BookmarkItem } from "@/contracts/bookmark.schema";

export function nextBookmarkOffset(page: { items: unknown[]; total: number }, offset: number) {
	const next = offset + page.items.length;
	return page.items.length > 0 && next < page.total ? next : undefined;
}
export function flattenBookmarkPages(pages: { items: BookmarkItem[] }[] | undefined) {
	const items = new Map<string, BookmarkItem>();
	for (const page of pages ?? []) for (const item of page.items) items.set(item.id, item);
	return [...items.values()];
}

type JobResult = { id: string; state: string; updated_at: string };
export function bookmarkResultsChanged(previous: JobResult[] | undefined, current: JobResult[]) {
	return (
		previous !== undefined &&
		current.some(
			(job) =>
				["succeeded", "partial", "paused", "failed"].includes(job.state) &&
				previous.find((old) => old.id === job.id)?.updated_at !== job.updated_at
		)
	);
}
