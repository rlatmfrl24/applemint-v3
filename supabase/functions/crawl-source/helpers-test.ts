/// <reference lib="deno.ns" />

import {
	calculateParserTrend,
	chunkUrlsForHistoryQuery,
	constantTimeEquals,
	countCrawlFailureKinds,
	countCrawlWarnings,
	dedupeByUrl,
	defineType,
	getCompletedRunStatus,
	hasMinimumInternalSecretLength,
	isCrawlTarget,
	normalizeCrawlApiBaseUrl,
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

Deno.test("crawl API base URL is required and limited to HTTP(S)", () => {
	assert(normalizeCrawlApiBaseUrl(undefined) === null, "missing URL should fail closed");
	assert(normalizeCrawlApiBaseUrl("file:///tmp/crawl") === null, "non-HTTP URL should fail");
	assert(
		normalizeCrawlApiBaseUrl("https://user:pass@example.com") === null,
		"credentials should fail"
	);
	assert(
		normalizeCrawlApiBaseUrl("https://example.com/?token=secret#fragment") ===
			"https://example.com",
		"query and fragment should not be retained"
	);
});

Deno.test("URL classification follows filter keyword methods", () => {
	assert(
		defineType("https://example.com/post", [{ value: "example.com", method: "source" }]) ===
			"source",
		"matching URLs should use the configured method"
	);
	assert(
		defineType("https://other.test/post", [{ value: "example.com", method: "source" }]) ===
			"normal",
		"non-matching URLs should fall back to normal"
	);
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

Deno.test("crawl warning count includes partial failures and parser warnings", () => {
	assert(countCrawlWarnings([{}], [{}, {}]) === 3, "all warning conditions should be counted");
});

Deno.test("failure causes are mutually exclusively classified", () => {
	const counts = countCrawlFailureKinds([
		{ kind: "network" },
		{ kind: "parser" },
		{ kind: "network", timeout: true },
	]);
	assert(counts.networkFailureCount === 1, "network failure should be counted");
	assert(counts.parserFailureCount === 1, "parser failure should be counted");
	assert(counts.timeoutFailureCount === 1, "timeout should not also count as network");
});

Deno.test("parser trend uses only the final attempt and excludes explicit empty minimums", () => {
	const trend = calculateParserTrend(
		[
			{ attempt: 1, status: "failure", validCount: 0, minimumItems: 10 },
			{ attempt: 2, status: "ok", validCount: 8, minimumItems: 10 },
			{ attempt: 2, status: "empty", validCount: 0, minimumItems: 10 },
		],
		1
	);
	assert(trend.parserValidCount === 8, "final attempt valid items should be summed");
	assert(trend.parserMinimumCount === 10, "empty pages should not add a minimum");
});

Deno.test("completed runs with warnings or failures are partial", () => {
	assert(getCompletedRunStatus([], []) === "succeeded", "clean run should succeed");
	assert(getCompletedRunStatus([{}], []) === "partial", "failure should make a partial run");
	assert(getCompletedRunStatus([], [{}]) === "partial", "warning should make a partial run");
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
