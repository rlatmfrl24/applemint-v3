import "server-only";
import { lookup, Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
export class HealthRequestDeferred extends Error {
	constructor(public readonly retryAt: string) {
		super("HEALTH_HOST_WAIT");
	}
}
export type HealthFetchOptions = {
	maxBytes?: number;
	signal?: AbortSignal;
	referrer?: string;
	beforeRequest?: (url: URL) => Promise<(retryAt?: string) => Promise<void>>;
};
export class BookmarkFetchError extends Error {
	constructor(
		public readonly code: "UNSAFE_URL" | "NXDOMAIN" | "TIMEOUT" | "NETWORK" | "REDIRECT_LIMIT"
	) {
		super(code);
	}
}
const blockedIPv4 = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3],
] as const;
function ipv4Number(address: string) {
	return address.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
}
export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		const value = ipv4Number(address);
		return !blockedIPv4.some(
			([network, prefix]) =>
				Math.floor(value / 2 ** (32 - prefix)) ===
				Math.floor(ipv4Number(network) / 2 ** (32 - prefix))
		);
	}
	if (family !== 6) return false;
	const [firstPart, secondPart] = address.toLowerCase().split(":");
	const first = Number.parseInt(firstPart || "0", 16);
	const second = Number.parseInt(secondPart || "0", 16);
	return (
		first >= 0x2000 &&
		first <= 0x3fff &&
		first !== 0x2002 &&
		first !== 0x3fff &&
		!(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
	);
}
function safeUrl(value: string) {
	try {
		const url = new URL(value);
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
			throw new Error();
		return url;
	} catch {
		throw new BookmarkFetchError("UNSAFE_URL");
	}
}
async function lookupBeforeDeadline(hostname: string, signal: AbortSignal) {
	let onAbort: () => void = () => {};
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(new BookmarkFetchError("TIMEOUT"));
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		signal.throwIfAborted();
		return await Promise.race([lookup(hostname, { all: true, verbatim: true }), aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
async function publicAddress(url: URL, signal: AbortSignal) {
	const hostname = url.hostname.replace(/^\[|\]$/gu, "");
	let addresses: { address: string; family: number }[];
	try {
		const family = isIP(hostname);
		addresses = family
			? [{ address: hostname, family }]
			: await lookupBeforeDeadline(hostname, signal);
	} catch (error) {
		if (signal.aborted) throw new BookmarkFetchError("TIMEOUT");
		if (
			(error as NodeJS.ErrnoException).code === "ENOTFOUND" &&
			(await isNxDomain(hostname, signal))
		)
			throw new BookmarkFetchError("NXDOMAIN");
		throw new BookmarkFetchError("NETWORK");
	}
	if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address)))
		throw new BookmarkFetchError("UNSAFE_URL");
	return addresses.find((a) => a.family === 4) ?? addresses[0];
}
async function isNxDomain(hostname: string, signal: AbortSignal) {
	// getaddrinfo also fails for missing address records; only DNS NXDOMAIN makes a dead candidate.
	const resolver = new Resolver({ timeout: 1000, tries: 1 });
	const cancel = () => resolver.cancel();
	signal.addEventListener("abort", cancel, { once: true });
	try {
		signal.throwIfAborted();
		await resolver.resolve4(hostname);
		return false;
	} catch (error) {
		if (signal.aborted) throw new BookmarkFetchError("TIMEOUT");
		return (error as NodeJS.ErrnoException).code === "ENOTFOUND";
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}
type HttpResult = {
	status: number;
	location?: string;
	contentType: string;
	body: string;
	bodyBytes: Uint8Array;
	truncated: boolean;
	retryAfter: string | null;
	contentEncoding: string | null;
};
function decodeBody(
	bytes: Buffer,
	contentType: string,
	encoding: string | null,
	maxBytes: number,
	truncated: boolean
) {
	try {
		const options = { maxOutputLength: Math.max(1, maxBytes) };
		if (bytes.length && encoding === "gzip") bytes = gunzipSync(bytes, options);
		else if (bytes.length && encoding === "br") bytes = brotliDecompressSync(bytes, options);
		else if (bytes.length && encoding === "deflate") bytes = inflateSync(bytes, options);
		else if (bytes.length && encoding && encoding !== "identity")
			return { body: "", bodyBytes: new Uint8Array(), truncated: true };
		const charset =
			/charset\s*=\s*["']?([^\s;"'>]+)/iu.exec(contentType)?.[1] ??
			/charset\s*=\s*["']?([^\s;"'>]+)/iu.exec(bytes.subarray(0, 2048).toString("latin1"))?.[1] ??
			"utf-8";
		const body = /^(?:image|video|audio)\//iu.test(contentType)
			? ""
			: new TextDecoder(charset, { fatal: true }).decode(bytes);
		return { body, bodyBytes: bytes, truncated };
	} catch {
		return { body: "", bodyBytes: new Uint8Array(), truncated: true };
	}
}
function requestPinned(
	url: URL,
	pinned: { address: string; family: number },
	signal: AbortSignal,
	maxBytes: number,
	referrer?: string
) {
	return new Promise<HttpResult>((resolve, reject) => {
		const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
			url,
			{
				method: "GET",
				signal,
				agent: false,
				family: pinned.family,
				headers: {
					"User-Agent": "Applemint-Bookmark-Check/1.0",
					Accept: "text/html,application/xhtml+xml,*/*;q=0.1",
					"Accept-Encoding": "identity",
					...(referrer ? { Referer: referrer, Range: "bytes=0-65535" } : {}),
				},
				lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const contentType = String(res.headers["content-type"] ?? "");
				const contentEncoding = res.headers["content-encoding"]
					? String(res.headers["content-encoding"]).toLowerCase()
					: null;
				const limit = /^(?:image|video|audio)\//iu.test(contentType)
					? Math.min(maxBytes, 65536)
					: maxBytes;
				const finish = (bytes: Buffer, truncated = false) =>
					resolve({
						status,
						location: res.headers.location,
						contentType,
						contentEncoding,
						retryAfter: res.headers["retry-after"] ? String(res.headers["retry-after"]) : null,
						...decodeBody(bytes, contentType, contentEncoding, limit, truncated),
					});
				if (maxBytes === 0 || (status >= 300 && status < 400)) {
					finish(Buffer.alloc(0));
					res.destroy();
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				res.on("data", (chunk: Buffer) => {
					chunks.push(chunk.subarray(0, Math.max(0, limit - size)));
					size += chunk.length;
					if (size > limit) {
						finish(Buffer.concat(chunks), true);
						res.destroy();
					}
				});
				res.on("end", () => finish(Buffer.concat(chunks)));
				res.on("error", () =>
					reject(new BookmarkFetchError(signal.aborted ? "TIMEOUT" : "NETWORK"))
				);
			}
		);
		req.on("socket", (socket) =>
			socket.once("connect", () => {
				const remote = socket.remoteAddress?.replace(/^::ffff:/u, "");
				if (!remote || !isPublicAddress(remote) || remote !== pinned.address)
					req.destroy(new BookmarkFetchError("UNSAFE_URL"));
			})
		);
		req.on("error", (error) =>
			reject(
				error instanceof BookmarkFetchError
					? error
					: new BookmarkFetchError(signal.aborted ? "TIMEOUT" : "NETWORK")
			)
		);
		req.end();
	});
}
export async function safeFetch(value: string, options: HealthFetchOptions = {}) {
	const signal = options.signal
		? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
		: AbortSignal.timeout(10000);
	if (signal.aborted) throw new BookmarkFetchError("TIMEOUT");
	let referrer: string | undefined;
	if (options.referrer) {
		const source = safeUrl(options.referrer);
		source.search = "";
		source.hash = "";
		referrer = source.toString();
	}
	let url = safeUrl(value);
	for (let redirects = 0; redirects <= 5; redirects++) {
		const address = await publicAddress(url, signal);
		const release = await options.beforeRequest?.(url);
		let result: HttpResult | undefined;
		try {
			result = await requestPinned(url, address, signal, options.maxBytes ?? 0, referrer);
		} finally {
			let retryAt: string | undefined;
			if (result && [429, 503].includes(result.status)) {
				const now = Date.now();
				const raw = result.retryAfter;
				const requested =
					raw && /^\d+$/u.test(raw) ? now + Number(raw) * 1000 : raw ? Date.parse(raw) : Number.NaN;
				retryAt = new Date(
					Math.min(
						now + 86400000,
						Number.isFinite(requested) ? Math.max(now + 2000, requested) : now + 900000
					)
				).toISOString();
			}
			await release?.(retryAt);
		}
		if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
			if (redirects === 5) throw new BookmarkFetchError("REDIRECT_LIMIT");
			url = safeUrl(new URL(result.location, url).toString());
			continue;
		}
		return { ...result, finalUrl: url.toString() };
	}
	throw new BookmarkFetchError("REDIRECT_LIMIT");
}
