import { CancelledError, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { BookmarkItem, BookmarkJob } from "@/contracts/bookmark.schema";
import { BOOKMARK_CHANGES_KEY, type BookmarkChange } from "./bookmark-optimistic";

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
				? Number(job.progress?.healthResultRevision ?? 0) >
						Number(old?.progress?.healthResultRevision ?? 0)
				: ["succeeded", "partial", "paused", "failed"].includes(job.state) &&
						(!old || old.updated_at < job.updated_at);
		})
	);
}

export function bookmarkJobsInterval(
	activity: boolean,
	jobs: Pick<BookmarkJob, "state">[] | undefined
) {
	return activity
		? 5000
		: jobs?.some((job) => ["queued", "processing", "retry"].includes(job.state))
			? 15000
			: 60000;
}

export async function refreshBookmarkFirstPage<T extends { items: BookmarkItem[]; total: number }>(
	cache: QueryClient,
	queryKey: QueryKey,
	read: (signal: AbortSignal) => Promise<T>
) {
	const acknowledged = (cache.getQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY) ?? [])
		.filter((change) => change.acknowledged)
		.map((change) => change.id);
	await cache.cancelQueries({ queryKey, exact: true });
	let completed = false;
	let requestSignal: AbortSignal | undefined;
	await cache.fetchInfiniteQuery({
		queryKey,
		queryFn: async ({ signal }) => {
			requestSignal = signal;
			const page = await read(signal);
			signal.throwIfAborted();
			completed = true;
			return page;
		},
		initialPageParam: 0,
		getNextPageParam: (page, _pages, offset) => nextBookmarkOffset(page, offset),
		pages: 1,
		staleTime: 0,
		retry: false,
	});
	// TanStack can resolve an observer-cancelled fetch with its previous cached data.
	if (!completed || requestSignal?.aborted) throw new CancelledError({ silent: true });
	const refreshedHash = cache.getQueryCache().find({ queryKey, exact: true })?.queryHash;
	const otherActiveList = cache
		.getQueryCache()
		.findAll({ queryKey: ["bookmarks", "list"], type: "active" })
		.some((query) => query.queryHash !== refreshedHash);
	if (acknowledged.length && !otherActiveList) {
		// Drop inactive stale lists before releasing acknowledged overlays after a recovered read.
		cache.removeQueries({
			predicate: (query) =>
				query.queryKey[0] === "bookmarks" &&
				query.queryKey[1] === "list" &&
				!query.isActive() &&
				query.queryHash !== refreshedHash,
		});
		cache.setQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY, (old) =>
			(old ?? []).filter((change) => !acknowledged.includes(change.id))
		);
		void cache.invalidateQueries({ queryKey: ["bookmarks", "detail"] });
	}
}
