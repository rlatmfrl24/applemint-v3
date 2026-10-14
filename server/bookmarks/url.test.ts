import { describe, expect, it } from "vitest";
import { normalizeBookmarkUrl } from "./url";

describe("direct bookmark URL boundary", () => {
	it("normalizes host and port without dropping query or fragment", () => {
		expect(normalizeBookmarkUrl(" HTTPS://Example.com:443/a?q=1#section ")).toBe(
			"https://example.com/a?q=1#section"
		);
	});
	it.each([
		"file:///c:/secrets",
		"javascript:alert(1)",
		"https://user:password@example.com",
		"bad url",
	])("rejects unsafe URL %s", (url) => {
		expect(() => normalizeBookmarkUrl(url)).toThrow();
	});
});
