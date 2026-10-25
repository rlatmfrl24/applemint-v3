import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import { refreshBookmarkResults } from "./bookmark-list";
import {
	BOOKMARK_CHANGES_KEY,
	type BookmarkChange,
	projectBookmarkItems,
	projectCollections,
	refreshBookmarkChanges,
} from "./bookmark-optimistic";

const item = (id: string) =>
	({ id, version: 3, state: "library", collection_id: "one" }) as BookmarkItem;
const change = (id: string, action: BookmarkChange["action"], itemId: string): BookmarkChange => ({
	id,
	action,
	items: [item(itemId)],
	collectionId: "two",
	acknowledged: false,
});
it("keep immediately leaves review, preserves library data, and rolls back on failure", () => {
	const items = [item("a"), item("b")];
	const keep = change("keep", "keep", "a");
	expect(projectBookmarkItems(items, [keep], { review: true })).toEqual([items[1]]);
	expect(projectBookmarkItems(items, [keep], {})).toEqual(items);
	expect(projectBookmarkItems([], [keep], {})).toEqual([]);
	expect(projectBookmarkItems(items, [], { review: true })).toEqual(items);
});
it("a successful result refresh clears keep retained after an earlier read failure", async () => {
	const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const seen = { ...item("a"), review_revision: 4 };
	const kept = { ...change("keep", "keep", "a"), items: [seen], acknowledged: true };
	const key = ["bookmarks", "list", { review: true }];
	let fail = false;
	let server = [seen];
	await cache.fetchQuery({
		queryKey: key,
		queryFn: async () => {
			if (fail) throw new Error("read failed");
			return server;
		},
	});
	cache.setQueryData(BOOKMARK_CHANGES_KEY, [kept]);
	fail = true;
	await expect(refreshBookmarkChanges(cache)).rejects.toThrow("read failed");
	expect(cache.getQueryData(BOOKMARK_CHANGES_KEY)).toEqual([kept]);
	fail = false;
	server = [{ ...seen, review_revision: 5 }];
	await refreshBookmarkResults(cache);
	expect(cache.getQueryData(BOOKMARK_CHANGES_KEY)).toEqual([]);
	expect(
		projectBookmarkItems(
			cache.getQueryData<BookmarkItem[]>(key) ?? [],
			cache.getQueryData<BookmarkChange[]>(BOOKMARK_CHANGES_KEY) ?? [],
			{ review: true }
		)
	).toEqual(server);
	cache.clear();
});
it("a failed operation can be removed without reversing a different item's pending move or changing page lengths", () => {
	const items = [item("a"), item("b")];
	const trash = change("first", "trash", "a");
	const move = change("second", "move", "b");
	expect(projectBookmarkItems(items, [trash, move], { state: "library" })).toMatchObject([
		{ id: "b", collection_id: "two" },
	]);
	expect(projectBookmarkItems(items, [move], { state: "library" })).toMatchObject([
		{ id: "a", collection_id: "one" },
		{ id: "b", collection_id: "two" },
	]);
	expect(items).toMatchObject([
		{ id: "a", state: "library", collection_id: "one" },
		{ id: "b", state: "library", collection_id: "one" },
	]);
	expect(items).toHaveLength(2);
	expect(
		projectBookmarkItems(items, [move], { state: "library", collectionId: "one" })
	).toMatchObject([{ id: "a" }]);
});
it("a restored item immediately leaves the trash view", () => {
	const trashed = { ...item("a"), state: "trash" as const };
	expect(
		projectBookmarkItems([trashed], [{ ...change("r", "restore", "a"), items: [trashed] }], {
			state: "trash",
		})
	).toEqual([]);
});
it.each(["move", "trash", "restore"] as const)(
	"a pending %s appears once in its destination without changing the fetched page",
	(action) => {
		const pending = change("pending", action, "a");
		if (action === "restore") pending.items[0].state = "trash";
		const filter = {
			state: action === "trash" ? "trash" : "library",
			collectionId: action === "move" ? "two" : "one",
		};
		const page: BookmarkItem[] = [];
		expect(projectBookmarkItems(page, [pending], filter)).toMatchObject([
			{ id: "a", state: filter.state, collection_id: filter.collectionId },
		]);
		expect(page).toEqual([]);
		expect(projectBookmarkItems([item("a")], [pending], filter)).toHaveLength(1);
		expect(projectBookmarkItems(page, [pending], { ...filter, search: "other" })).toEqual([]);
		expect(projectBookmarkItems(page, [pending], { ...filter, review: true })).toEqual([]);
	}
);
it("collection reordering only changes display order of siblings and preserves server versions", () => {
	const collections = [
		{ id: "a", parent_id: null, sort_order: 0, version: 4 },
		{ id: "b", parent_id: null, sort_order: 1, version: 7 },
		{ id: "c", parent_id: "a", sort_order: 0, version: 2 },
	] as BookmarkCollection[];
	const projected = projectCollections(collections, [
		{ kind: "reorder", id: "b", targetId: "a", position: "before" },
	]);
	expect(projected.find((c) => c.id === "b")).toMatchObject({ sort_order: 0, version: 7 });
	expect(projected.find((c) => c.id === "a")).toMatchObject({ sort_order: 1, version: 4 });
	expect(projected.find((c) => c.id === "c")).toMatchObject({
		parent_id: "a",
		sort_order: 0,
		version: 2,
	});
});
it("server-acknowledged changes remain visible when authoritative refresh fails, then clear after a successful retry", async () => {
	const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	let fail = false;
	await cache.fetchQuery({
		queryKey: ["bookmarks", "list", {}],
		queryFn: async () => {
			if (fail) throw new Error("offline");
			return { items: [] };
		},
	});
	const accepted = { ...change("done", "trash", "a"), acknowledged: true };
	cache.setQueryData(BOOKMARK_CHANGES_KEY, [accepted]);
	fail = true;
	await expect(refreshBookmarkChanges(cache)).rejects.toThrow("offline");
	expect(cache.getQueryData(BOOKMARK_CHANGES_KEY)).toEqual([accepted]);
	fail = false;
	await refreshBookmarkChanges(cache);
	expect(cache.getQueryData(BOOKMARK_CHANGES_KEY)).toEqual([]);
	cache.clear();
});
it("a restore from another screen does not insert an unverified match into search or review results", () => {
	const restored = {
		...change("r", "restore", "a"),
		items: [{ ...item("a"), state: "trash" as const }],
	};
	expect(projectBookmarkItems([], [restored], { state: "library", search: "다른 제목" })).toEqual(
		[]
	);
	expect(projectBookmarkItems([], [restored], { state: "library", review: true })).toEqual([]);
});

it("a rejected command refreshes stale versions even when no other optimistic operation remains", async () => {
	const cache = new QueryClient();
	let version = 1;
	const key = ["bookmarks", "list", {}];
	await cache.fetchQuery({ queryKey: key, queryFn: async () => ({ version }) });
	version = 2;
	await refreshBookmarkChanges(cache, true);
	expect(cache.getQueryData(key)).toEqual({ version: 2 });
	cache.clear();
});
