import type { CrawlItemType } from "@/lib/type-defs";
import {
	type CrawlAdapterOptions,
	type CrawlFailure,
	type CrawlSourceResult,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { ISSUELINK_BASE_URL, parseIssueLinkHtml, parseIssueLinkUrl } from "./issuelink-parser";
import { debugLog } from "./logger";
import { adaptParserOutcome } from "./parser-adapter";

export const ISSUELINK_TARGET = `${ISSUELINK_BASE_URL}/community/listview/all/12/adj/_self/blank/blank/blank`;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function resolveOriginalUrl(
	item: CrawlItemType,
	request: RequestInit
): Promise<{ item: CrawlItemType } | { failure: CrawlFailure }> {
	let kind: CrawlFailure["kind"] = "parser";
	try {
		if (!parseIssueLinkUrl(item.url)) throw new Error("유효한 IssueLink 게시물 주소가 아닙니다.");
		kind = "network";
		request.signal?.throwIfAborted();
		const response = await fetchWithTimeout(item.url, { ...request, redirect: "manual" });
		const location = response.headers.get("location");
		await response.body?.cancel();
		if (!REDIRECT_STATUSES.has(response.status)) {
			kind = response.ok ? "parser" : "network";
			throw new Error(`원문 리다이렉트가 아닙니다: HTTP ${response.status}`);
		}
		kind = "parser";
		if (!location) throw new Error("원문 리다이렉트에 Location이 없습니다.");
		const original = new URL(location, item.url);
		const hostname = original.hostname.replace(/\.+$/u, "");
		if (
			!["http:", "https:"].includes(original.protocol) ||
			original.username ||
			original.password ||
			hostname === "issuelink.co.kr" ||
			hostname.endsWith(".issuelink.co.kr")
		) {
			throw new Error("유효한 커뮤니티 원문 주소가 아닙니다.");
		}
		return {
			item: {
				...item,
				url: original.href,
				historyUrl: item.url,
				host: item.host === ISSUELINK_BASE_URL ? original.origin : item.host,
			},
		};
	} catch (error) {
		return {
			failure: {
				url: item.url,
				message: getErrorMessage(error),
				kind,
				timeout: isTimeoutError(error),
			},
		};
	}
}

export async function crawlIssueLink(
	options: CrawlAdapterOptions = {}
): Promise<CrawlSourceResult> {
	debugLog("[IssueLink] 크롤링 시작");
	const request: RequestInit = {
		signal: options.signal,
		cache: "no-store",
		headers: {
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
		},
	};
	const result: CrawlSourceResult = {
		items: [],
		attemptedUrls: [],
		attempted: 0,
		succeeded: 0,
		failures: [],
		warnings: [],
		parserObservations: [],
	};
	let candidates = options.retryItems?.filter(
		(item) => !options.urls || options.urls.includes(item.url)
	);
	if (!candidates) {
		if (options.urls && !options.urls.includes(ISSUELINK_TARGET)) return result;
		result.attemptedUrls = [ISSUELINK_TARGET];
		result.attempted = 1;
		try {
			options.signal?.throwIfAborted();
			const response = await fetchWithTimeout(ISSUELINK_TARGET, request);
			if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
			const outcome = parseIssueLinkHtml(await response.text());
			const parsed = adaptParserOutcome(ISSUELINK_TARGET, outcome);
			result.warnings = parsed.warnings;
			result.parserObservations = [parsed.observation];
			if (parsed.failure) {
				result.failures.push(parsed.failure);
				return result;
			}
			candidates = parsed.items;
		} catch (error) {
			result.failures.push({
				url: ISSUELINK_TARGET,
				message: getErrorMessage(error),
				kind: "network",
				timeout: isTimeoutError(error),
			});
			return result;
		}
	}

	// A source success means an original URL was obtained, not merely that the list loaded.
	result.attemptedUrls = candidates.map((item) => item.url);
	result.attempted = candidates.length;
	result.retryItems = [];
	for (let index = 0; index < candidates.length; index += 4) {
		const batch = candidates.slice(index, index + 4);
		const resolved = await Promise.all(batch.map((item) => resolveOriginalUrl(item, request)));
		resolved.forEach((entry, itemIndex) => {
			if ("failure" in entry) {
				result.failures.push(entry.failure);
				result.retryItems?.push(batch[itemIndex]);
			} else {
				result.items.push(entry.item);
				result.succeeded += 1;
			}
		});
	}
	return result;
}
