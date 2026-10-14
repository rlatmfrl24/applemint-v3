import "server-only";
import { lookup, Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
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
type HttpResult = { status: number; location?: string; contentType: string; body: string };
function requestPinned(
	url: URL,
	pinned: { address: string; family: number },
	signal: AbortSignal,
	maxBytes: number
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
				},
				lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const finish = (body: string) =>
					resolve({
						status,
						location: res.headers.location,
						contentType: res.headers["content-type"] ?? "",
						body,
					});
				if (maxBytes === 0 || (status >= 300 && status < 400)) {
					finish("");
					res.destroy();
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				res.on("data", (chunk: Buffer) => {
					chunks.push(chunk.subarray(0, Math.max(0, maxBytes - size)));
					size += chunk.length;
					if (size >= maxBytes) {
						finish(Buffer.concat(chunks).toString("utf8"));
						res.destroy();
					}
				});
				res.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
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
export async function safeFetch(value: string, options: { maxBytes?: number } = {}) {
	const signal = AbortSignal.timeout(10000);
	let url = safeUrl(value);
	for (let redirects = 0; redirects <= 5; redirects++) {
		const result = await requestPinned(
			url,
			await publicAddress(url, signal),
			signal,
			options.maxBytes ?? 0
		);
		if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
			if (redirects === 5) throw new BookmarkFetchError("REDIRECT_LIMIT");
			url = safeUrl(new URL(result.location, url).toString());
			continue;
		}
		return { ...result, finalUrl: url.toString() };
	}
	throw new BookmarkFetchError("REDIRECT_LIMIT");
}
