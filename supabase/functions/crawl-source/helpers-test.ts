/// <reference lib="deno.ns" />

import {
	chunkUrlsForHistoryQuery,
	constantTimeEquals,
	dedupeByUrl,
	defineType,
	getUrlExtension,
	hasMinimumInternalSecretLength,
	isCrawlTarget,
} from "./helpers.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

Deno.test("internal secret comparison accepts only an exact match", async () => {
	const secret = "0123456789abcdef0123456789abcdef";
	assert(await constantTimeEquals(secret, secret), "matching secret should pass");
	assert(!(await constantTimeEquals(`${secret}x`, secret)), "different secret should fail");
	assert(!(await constantTimeEquals(null, secret)), "missing secret should fail");
});

Deno.test("internal secret requires at least 32 UTF-8 bytes", () => {
	assert(!hasMinimumInternalSecretLength("a".repeat(31)), "31-byte secret should fail");
	assert(hasMinimumInternalSecretLength("a".repeat(32)), "32-byte secret should pass");
	assert(
		hasMinimumInternalSecretLength("가".repeat(11)),
		"multibyte secret should use byte length"
	);
});

Deno.test("crawl target validation is allowlist based", () => {
	assert(isCrawlTarget("arcalive"), "known target should pass");
	assert(!isCrawlTarget("unknown"), "unknown target should fail");
});

Deno.test("URL classification validates youtube IDs and media extensions", () => {
	assert(
		defineType("https://youtu.be/abcdefghijk", [{ value: "youtu.be", method: "youtube" }]) ===
			"youtube",
		"valid youtube URL should be classified"
	);
	assert(
		defineType("https://youtu.be/invalid", [{ value: "youtu.be", method: "youtube" }]) === "normal",
		"invalid youtube URL should fall back to normal"
	);
	assert(
		defineType("https://example.com/image.JPG?size=large", [
			{ value: "example.com", method: "media" },
		]) === "media",
		"media URL should use its pathname extension"
	);
	assert(getUrlExtension("not a URL") === "", "invalid URL should have no extension");
});

Deno.test("URL deduplication keeps the first item", () => {
	const result = dedupeByUrl([
		{ url: "https://example.com/1", title: "first" },
		{ url: "https://example.com/1", title: "duplicate" },
		{ url: "https://example.com/2", title: "second" },
	]);

	assert(result.length === 2, "duplicate URL should be removed");
	assert(result[0].title === "first", "first item should win");
});

Deno.test("history query chunks limit both item count and encoded URL length", () => {
	const urls = Array.from(
		{ length: 306 },
		(_, index) =>
			`https://v12.battlepage.com/??=Board.Humor.View&no=${index}&title=${"가".repeat(20)}`
	);
	const chunks = chunkUrlsForHistoryQuery(urls);

	assert(chunks.length > 1, "long Battlepage URLs should be split into multiple chunks");
	assert(chunks.flat().join("\n") === urls.join("\n"), "chunking should preserve URL order");
	assert(
		chunks.every((chunk) => chunk.length <= 200),
		"a chunk should contain at most 200 URLs"
	);
	assert(
		chunks.every(
			(chunk) =>
				chunk.length === 1 ||
				chunk.reduce((total, url) => total + encodeURIComponent(url).length + 3, 0) <= 6000
		),
		"a multi-URL chunk should stay within the encoded query budget"
	);
});
