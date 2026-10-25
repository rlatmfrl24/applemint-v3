import type { QueryClient } from "@tanstack/react-query";
import type { BookmarkItem } from "@/contracts/bookmark.schema";

export function bookmarkItemLocation(item: Pick<BookmarkItem, "id" | "state">) {
	return `/main/bookmarks?state=${item.state}&bookmark=${item.id}`;
}

export function nextBookmarkOffset(page: { items: unknown[]; total: number }, offset: number) {
	const next = offset + page.items.length;
	return page.items.length > 0 && next < page.total ? next : undefined;
}
export function flattenBookmarkPages(pages: { items: BookmarkItem[] }[] | undefined) {
	const items = new Map<string, BookmarkItem>();
	for (const page of pages ?? []) for (const item of page.items) items.set(item.id, item);
	return [...items.values()];
}

type JobResult = {
	id: string;
	kind?: string;
	state: string;
	updated_at: string;
	progress?: Record<string, unknown>;
};
export function bookmarkResultsChanged(previous: JobResult[] | undefined, current: JobResult[]) {
	return (
		previous !== undefined &&
		current.some((job) => {
			const old = previous.find((value) => value.id === job.id);
			return job.kind === "check"
				? (old?.progress?.healthResultRevision ?? 0) !== (job.progress?.healthResultRevision ?? 0)
				: ["succeeded", "partial", "paused", "failed"].includes(job.state) &&
						old?.updated_at !== job.updated_at;
		})
	);
}

const resultRefreshes = new WeakMap<QueryClient, { pending: boolean; promise: Promise<void> }>();
export function refreshBookmarkResults(cache: QueryClient) {
	const running = resultRefreshes.get(cache);
	if (running) {
		running.pending = true;
		return running.promise;
	}
	const refresh = { pending: true, promise: Promise.resolve() };
	resultRefreshes.set(cache, refresh);
	refresh.promise = (async () => {
		do {
			// Finish the current read, then fetch changes that may postdate its DB snapshot.
			await Promise.all(
				cache
					.getQueryCache()
					.findAll({
						predicate: (query) =>
							query.queryKey[0] === "bookmarks" &&
							["list", "detail", "collections"].includes(String(query.queryKey[1])) &&
							query.isActive() &&
							query.state.fetchStatus === "fetching",
					})
					.map((query) => query.promise?.catch(() => undefined))
			);
			refresh.pending = false;
			await Promise.all(
				["list", "detail", "collections"].map((key) =>
					cache.invalidateQueries({ queryKey: ["bookmarks", key] }, { cancelRefetch: false })
				)
			);
		} while (refresh.pending);
	})().finally(() => resultRefreshes.delete(cache));
	return refresh.promise;
}
