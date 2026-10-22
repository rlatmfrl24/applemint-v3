import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { beforeEach, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: network.request }));
vi.mock("node:http", () => ({ request: network.request }));
vi.mock("node:dns/promises", async (original) => ({
	...(await original<typeof import("node:dns/promises")>()),
	lookup: async () => [{ address: "1.1.1.1", family: 4 }],
}));

import { safeFetch } from "./safe-fetch";

function reply(bytes: Uint8Array, headers: Record<string, string> = {}, status = 200) {
	network.request.mockImplementationOnce((_url, options, callback) => {
		const req = new EventEmitter() as EventEmitter & { end: () => void };
		req.end = () => {
			const res = Readable.from([Buffer.from(bytes)]);
			Object.assign(res, { statusCode: status, headers });
			callback(res);
		};
		options.signal.addEventListener("abort", () => req.emit("error", new Error("aborted")), {
			once: true,
		});
		return req;
	});
}
beforeEach(() => network.request.mockReset());
it("enforces wire and decoded bounds and preserves exact byte boundaries", async () => {
	reply(new Uint8Array(32).fill(65));
	expect(await safeFetch("https://example.com", { maxBytes: 32 })).toMatchObject({
		truncated: false,
		body: "A".repeat(32),
	});
	reply(new Uint8Array(33).fill(65));
	expect(await safeFetch("https://example.com", { maxBytes: 32 })).toMatchObject({
		truncated: true,
	});
	reply(gzipSync(Buffer.from("A".repeat(1000))), { "content-encoding": "gzip" });
	expect(await safeFetch("https://example.com", { maxBytes: 64 })).toMatchObject({
		truncated: true,
	});
});
it("decodes declared EUC-KR and releases the host permit", async () => {
	const release = vi.fn();
	reply(Uint8Array.from([0xb0, 0xa1]), { "content-type": "text/html; charset=euc-kr" });
	expect(
		(await safeFetch("https://example.com", { maxBytes: 32, beforeRequest: async () => release }))
			.body
	).toBe("가");
	expect(release).toHaveBeenCalledOnce();
});
it("does not acquire a permit or open a socket after parent cancellation", async () => {
	const permit = vi.fn();
	await expect(
		safeFetch("https://example.com", { signal: AbortSignal.abort(), beforeRequest: permit })
	).rejects.toMatchObject({ code: "TIMEOUT" });
	expect(network.request).not.toHaveBeenCalled();
	expect(permit).not.toHaveBeenCalled();
});
it("validates every redirect before its host permit", async () => {
	const permit = vi.fn(async () => vi.fn());
	reply(new Uint8Array(), { location: "http://127.0.0.1/private" }, 302);
	await expect(safeFetch("https://example.com", { beforeRequest: permit })).rejects.toMatchObject({
		code: "UNSAFE_URL",
	});
	expect(network.request).toHaveBeenCalledTimes(1);
	expect(permit).toHaveBeenCalledTimes(1);
});
it("resumes a redirect after the host cooldown without re-requesting the original URL", async () => {
	const { HealthRequestDeferred } = await import("./safe-fetch");
	reply(new Uint8Array(), { location: "https://example.com/final" }, 301);
	const permit = vi
		.fn()
		.mockResolvedValueOnce(vi.fn())
		.mockRejectedValueOnce(new HealthRequestDeferred("2026-10-22T04:00:02Z"));
	const deferred = await safeFetch("http://example.com/start", { beforeRequest: permit }).catch(
		(error) => error
	);
	expect(deferred).toMatchObject({
		continuation: { url: "https://example.com/final", redirects: 1 },
	});
	reply(Buffer.from("final body"), { "content-type": "text/html" });
	const result = await safeFetch("http://example.com/start", {
		maxBytes: 128,
		beforeRequest: async () => async () => {},
		continuation: deferred.continuation,
	});
	expect(result.body).toBe("final body");
	expect(String(network.request.mock.calls[1][0])).toBe("https://example.com/final");
	expect(network.request).toHaveBeenCalledTimes(2);
});
