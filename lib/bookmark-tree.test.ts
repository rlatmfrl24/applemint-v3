import { expect, it } from "vitest";
import type { BookmarkCollection } from "@/contracts/bookmark.schema";
import {
	canReparentCollection,
	collectionAncestors,
	collectionChildren,
	collectionDropPosition,
} from "./bookmark-tree";

const collections = [
	{ id: "root", parent_id: null, name: "Root" },
	{ id: "child", parent_id: "root", name: "Child" },
	{ id: "leaf", parent_id: "child", name: "Leaf" },
] as BookmarkCollection[];
it("keeps direct children separate from descendants and opens the selected item's ancestors", () => {
	expect(collectionChildren("root", collections).map((c) => c.id)).toEqual(["child"]);
	expect(collectionAncestors("leaf", collections)).toEqual(["child", "root"]);
	expect(collectionChildren(null, collections).map((c) => c.id)).toEqual(["root"]);
});
it("allows promotion but rejects a collection's own subtree as its new parent", () => {
	expect(canReparentCollection("child", null, collections)).toBe(true);
	expect(canReparentCollection("child", "root", collections)).toBe(true);
	expect(canReparentCollection("root", "root", collections)).toBe(false);
	expect(canReparentCollection("root", "leaf", collections)).toBe(false);
});
it("terminates safely if imported ancestry contains a cycle", () => {
	expect(
		collectionAncestors("root", [{ id: "root", parent_id: "root" }] as BookmarkCollection[])
	).toEqual([]);
});
it("orders siblings by saved position without changing the source array", () => {
	const siblings = [
		{ id: "a", parent_id: null, name: "A", sort_order: 3 },
		{ id: "b", parent_id: null, name: "B", sort_order: 1 },
		{ id: "c", parent_id: "a", name: "C", sort_order: 0 },
	] as BookmarkCollection[];
	expect(collectionChildren(null, siblings).map((c) => c.id)).toEqual(["b", "a"]);
	expect(siblings.map((c) => c.id)).toEqual(["a", "b", "c"]);
});
it("uses the top and bottom quarters for ordering and the middle for nesting", () => {
	expect(collectionDropPosition(0, 40)).toBe("before");
	expect(collectionDropPosition(9, 40)).toBe("before");
	expect(collectionDropPosition(10, 40)).toBe("inside");
	expect(collectionDropPosition(29, 40)).toBe("inside");
	expect(collectionDropPosition(30, 40)).toBe("after");
	expect(collectionDropPosition(40, 40)).toBe("after");
});
