import { beforeEach, expect, it, vi } from "vitest";
import { checkBookmarkLink } from "./health";
import { BookmarkFetchError, safeFetch } from "./safe-fetch";

vi.mock("./safe-fetch", async (importOriginal) => ({
	...(await importOriginal<typeof import("./safe-fetch")>()),
	safeFetch: vi.fn(),
}));
beforeEach(() => {
	vi.mocked(safeFetch).mockReset();
});
it.each([
	[200, "healthy"],
	[404, "dead"],
	[410, "dead"],
	[401, "restricted"],
	[403, "restricted"],
	[429, "restricted"],
	[500, "temporary"],
	[503, "temporary"],
	[408, "temporary"],
	[400, "uncheckable"],
] as const)("HTTP %s classifies as %s", async (status, expected) => {
	vi.mocked(safeFetch).mockResolvedValue({
		status,
		body: "",
		bodyBytes: new Uint8Array(),
		truncated: false,
		retryAfter: null,
		contentEncoding: null,
		contentType: "text/html",
		finalUrl: "https://example.com/",
	});
	expect((await checkBookmarkLink("https://example.com")).status).toBe(expected);
});
it("a login redirect does not become a dead or healthy candidate", async () => {
	vi.mocked(safeFetch).mockResolvedValue({
		status: 200,
		body: "",
		bodyBytes: new Uint8Array(),
		truncated: false,
		retryAfter: null,
		contentEncoding: null,
		contentType: "text/html",
		finalUrl: "https://example.com/login",
	});
	expect(await checkBookmarkLink("https://example.com")).toMatchObject({
		status: "restricted",
		finalUrl: "https://example.com/login",
	});
});
it.each([
	["TIMEOUT", "temporary"],
	["NXDOMAIN", "dead"],
	["UNSAFE_URL", "uncheckable"],
	["REDIRECT_LIMIT", "uncheckable"],
] as const)("%s preserves uncertainty", async (code, status) => {
	vi.mocked(safeFetch).mockRejectedValue(new BookmarkFetchError(code));
	expect(await checkBookmarkLink("https://example.com")).toMatchObject({
		status,
		httpStatus: null,
	});
});
