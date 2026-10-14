import { afterEach, expect, it, vi } from "vitest";
import { parseRaindropPage, raindropManifest } from "./raindrop";

afterEach(() => vi.unstubAllGlobals());
it("Free manifests retain empty children and unsorted while excluding trash", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ result: true, user: { _id: 1, pro: false } }))
		.mockResolvedValueOnce(
			Response.json({ result: true, items: [{ _id: 10, title: "Parent", count: 3 }] })
		)
		.mockResolvedValueOnce(
			Response.json({
				result: true,
				items: [{ _id: 11, title: "Empty", count: 0, parent: { $id: 10 } }],
			})
		)
		.mockResolvedValueOnce(
			Response.json({
				result: true,
				items: [
					{ _id: 0, count: 5 },
					{ _id: -1, count: 2 },
					{ _id: -99, count: 99 },
				],
			})
		);
	vi.stubGlobal("fetch", fetch);
	const manifest = await raindropManifest("test-server-token");
	expect(manifest).toMatchObject({
		free: true,
		total: 5,
		collections: [
			{ sourceId: "-1" },
			{ sourceId: "10" },
			{ sourceId: "11", original: { count: 0, parentSourceId: "10" } },
		],
	});
	expect(
		fetch.mock.calls.every(([url]) => String(url).startsWith("https://api.raindrop.io/rest/v1/"))
	).toBe(true);
});
it("source duplicates preserve distinct IDs, tags, note and timestamps", () => {
	const first = {
		_id: 1,
		link: "https://example.com",
		title: "First",
		tags: ["one"],
		note: "keep note",
		created: "2020-01-01T00:00:00Z",
		collection: { $id: -1 },
	};
	const items = parseRaindropPage({ items: [first, { ...first, _id: 2, title: "Second" }] });
	expect(items).toHaveLength(2);
	expect(items.map((item) => item.sourceId)).toEqual(["1", "2"]);
	expect(items[0]).toMatchObject({
		tags: ["one"],
		note: "keep note",
		savedAt: "2020-01-01T00:00:00.000Z",
		original: first,
	});
	expect(() => parseRaindropPage({ items: [{ ...first, collection: { $id: -99 } }] })).toThrow(
		"TRASH_RETURNED"
	);
});
