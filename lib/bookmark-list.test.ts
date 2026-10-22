import { expect, it } from "vitest";
import type { BookmarkItem } from "@/contracts/bookmark.schema";
import { bookmarkResultsChanged, flattenBookmarkPages, nextBookmarkOffset } from "./bookmark-list";

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
it("refreshes provisional check evidence during retry and processing without refreshing unchanged polls", () => {
	const previous = [{ id: "health", kind: "check", state: "retry", updated_at: "1" }];
	for (const state of ["retry", "processing"]) {
		expect(bookmarkResultsChanged(previous, [{ ...previous[0], state, updated_at: "2" }])).toBe(
			true
		);
	}
	expect(bookmarkResultsChanged(previous, previous)).toBe(false);
});
