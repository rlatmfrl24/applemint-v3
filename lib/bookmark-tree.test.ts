import { expect, it } from "vitest";
import type { BookmarkCollection } from "@/contracts/bookmark.schema";
import { collectionAncestors, collectionChildren } from "./bookmark-tree";

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
it("terminates safely if imported ancestry contains a cycle", () => {
	expect(
		collectionAncestors("root", [{ id: "root", parent_id: "root" }] as BookmarkCollection[])
	).toEqual([]);
});
