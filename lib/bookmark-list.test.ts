import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { BookmarkItem } from "@/contracts/bookmark.schema";
import {
	bookmarkJobsInterval,
	bookmarkResultsChanged,
	flattenBookmarkPages,
	nextBookmarkOffset,
	refreshBookmarkFirstPage,
} from "./bookmark-list";

it("continues by the actual returned count and stops at the end or an empty batch", () => {
	expect(nextBookmarkOffset({ items: Array(100), total: 250 }, 0)).toBe(100);
	expect(nextBookmarkOffset({ items: Array(100), total: 250 }, 100)).toBe(200);
	expect(nextBookmarkOffset({ items: Array(50), total: 250 }, 200)).toBeUndefined();
	expect(nextBookmarkOffset({ items: [], total: 250 }, 100)).toBeUndefined();
});
it("keeps loaded order without duplicate rows and uses the latest returned item version", () => {
	const first = { id: "first", version: 1 } as BookmarkItem;
	const second = { id: "second", version: 1 } as BookmarkItem;
	expect(
		flattenBookmarkPages([{ items: [first, second] }, { items: [{ ...second, version: 2 }] }])
	).toEqual([first, { ...second, version: 2 }]);
	expect(flattenBookmarkPages(undefined)).toEqual([]);
});

it("refreshes results on completed or stopped work, not every unchanged progress poll", () => {
	const running = { id: "job", state: "processing", updated_at: "1" };
	expect(bookmarkResultsChanged(undefined, [{ ...running, state: "succeeded" }])).toBe(false);
	expect(bookmarkResultsChanged([running], [{ ...running, updated_at: "2" }])).toBe(false);
	for (const state of ["succeeded", "partial", "paused", "failed"]) {
		const stopped = { ...running, state, updated_at: "2" };
		expect(bookmarkResultsChanged([running], [stopped])).toBe(true);
		expect(bookmarkResultsChanged([stopped], [stopped])).toBe(false);
		expect(bookmarkResultsChanged([], [stopped])).toBe(true);
	}
});
it("refreshes published check evidence but ignores claim and checkpoint changes", () => {
	const previous = [
		{
			id: "health",
			kind: "check",
			state: "retry",
			updated_at: "1",
			progress: { healthResultRevision: 1 },
		},
	];
	for (const state of ["retry", "processing"]) {
		expect(bookmarkResultsChanged(previous, [{ ...previous[0], state, updated_at: "2" }])).toBe(
			false
		);
	}
	expect(
		bookmarkResultsChanged(previous, [
			{ ...previous[0], updated_at: "2", progress: { healthResultRevision: 2 } },
		])
	).toBe(true);
	expect(bookmarkResultsChanged(previous, previous)).toBe(false);
	expect(
		bookmarkResultsChanged([{ ...previous[0], progress: { healthResultRevision: 3 } }], previous)
	).toBe(false);
});

it("polls jobs without turning idle library views into five-second polls", () => {
	expect(bookmarkJobsInterval(true, [])).toBe(5000);
	expect(bookmarkJobsInterval(false, undefined)).toBe(60000);
	for (const state of ["queued", "processing", "retry"] as const)
		expect(bookmarkJobsInterval(false, [{ state }])).toBe(15000);
	expect(bookmarkJobsInterval(false, [{ state: "succeeded" }])).toBe(60000);
});

it("refreshes exactly one first page and preserves all cached pages on failure", async () => {
	const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const key = ["bookmarks", "list", { review: true }];
	const old = {
		pages: [
			{ items: [], total: 200 },
			{ items: [], total: 200 },
		],
		pageParams: [0, 100],
	};
	cache.setQueryData(key, old);
	const read = vi
		.fn()
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValueOnce({ items: [], total: 7 });
	await expect(refreshBookmarkFirstPage(cache, key, read)).rejects.toThrow("offline");
	expect(cache.getQueryData(key)).toEqual(old);
	await refreshBookmarkFirstPage(cache, key, read);
	expect(read).toHaveBeenCalledTimes(2);
	expect(cache.getQueryData(key)).toEqual({ pages: [{ items: [], total: 7 }], pageParams: [0] });
	cache.clear();
});
