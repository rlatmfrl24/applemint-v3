import { beforeEach, expect, it, vi } from "vitest";
import { inspectBookmarkPage } from "./health";
import { classifyHealthMedia, probeHealthMedia } from "./health-media";
import { safeFetch } from "./safe-fetch";

vi.mock("./safe-fetch", async (original) => ({
	...(await original<typeof import("./safe-fetch")>()),
	safeFetch: vi.fn(),
}));
const ref = {
	kind: "image" as const,
	url: "https://cdn.example.com/a.jpg?sig=keep",
	sourceUrl: "https://example.com/post",
	label: "cdn.example.com/a.jpg",
	urlHash: "a".repeat(64),
};
const response = (status: number, contentType: string, bytes = new Uint8Array()) => ({
	status,
	contentType,
	body: "",
	bodyBytes: bytes,
	finalUrl: ref.url,
	truncated: false,
	retryAfter: null,
	contentEncoding: null,
});
beforeEach(() => vi.mocked(safeFetch).mockReset());
it("direct media bypasses HTML extraction", async () => {
	vi.mocked(safeFetch).mockResolvedValue(
		response(200, "image/jpeg", Uint8Array.from([255, 216, 255, 0]))
	);
	const result = await inspectBookmarkPage(
		{ bookmarkId: "test", url: ref.url, version: 1, baseline: null, decisionSample: false },
		{ signal: new AbortController().signal, beforeRequest: async () => async () => {} }
	);
	expect(result.evidence.content.applicable).toBe(false);
	expect(result.evidence.media.status).toBe("present");
	expect(safeFetch).toHaveBeenCalledOnce();
});
it("a 200 HTML error response is not a photograph", () => {
	expect(
		classifyHealthMedia(ref, response(200, "text/html", new TextEncoder().encode("removed"))).state
	).toBe("unknown");
	expect(
		classifyHealthMedia(ref, response(200, "image/jpeg", Uint8Array.from([255, 216, 255, 0]))).state
	).toBe("reachable");
});
it.each([401, 403, 429])("HTTP %s media remains restricted", (status) => {
	expect(classifyHealthMedia(ref, response(status, "text/html")).state).toBe("restricted");
});
it("media fetch preserves the signature and supplies a sanitized referrer", async () => {
	vi.mocked(safeFetch).mockResolvedValue(response(404, "text/html"));
	const result = await probeHealthMedia(ref, {
		signal: new AbortController().signal,
		beforeRequest: async () => async () => {},
	});
	expect(result.state).toBe("missing");
	expect(safeFetch).toHaveBeenCalledWith(
		ref.url,
		expect.objectContaining({ maxBytes: 65536, referrer: ref.sourceUrl })
	);
});
