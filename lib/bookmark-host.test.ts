import { expect, it } from "vitest";
import { collectionForHost } from "./bookmark-host";

const collections = [
	{ id: "arca", name: "arcalive", version: 2 },
	{ id: "battle", name: "battlepage", version: 3 },
	{ id: "fm", name: "FMKOREA", version: 1 },
	{ id: "example", name: "example.com", version: 1 },
];
it("selects canonical arcalive and battlepage names, including valid subdomains", () => {
	expect(collectionForHost("https://arca.live/b/test/1", collections)?.id).toBe("arca");
	expect(collectionForHost("https://v12.battlepage.com/other/1", collections)?.id).toBe("battle");
	expect(collectionForHost("https://www.fmkorea.com/1", collections)?.id).toBe("fm");
	expect(collectionForHost("https://example.com/post/1", collections)?.id).toBe("example");
});
it("matches names exactly and never uses path, query or an unrelated hostname suffix", () => {
	for (const url of [
		"https://example.org/arcalive",
		"https://arca.live.attacker.com/1",
		"https://fakebattlepage.com/1",
		"https://other.com/?host=battlepage",
		"invalid",
		"javascript:alert(1)",
	])
		expect(collectionForHost(url, collections)).toBeNull();
	expect(
		collectionForHost("https://arca.live/1", [{ id: "partial", name: "arcalive 모음", version: 1 }])
	).toBeNull();
});
it("does not arbitrarily choose between duplicate matching names in different branches", () => {
	expect(
		collectionForHost("https://arca.live/1", [
			...collections,
			{ id: "second", name: "Arcalive", version: 1 },
		])
	).toBeNull();
});

it("recognizes a simple hostname outside a curated TLD list", () => {
	expect(
		collectionForHost("https://typesafe.ai/blog/1", [{ id: "typesafe", name: "typesafe" }])?.id
	).toBe("typesafe");
});
