import type { CrawlItemType } from "@/lib/type-defs";
import {
	type CrawlFailure,
	type CrawlSourceResult,
	type CrawlWarning,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { parseIssuelinkHtml } from "./issuelink-parser";
import { debugLog } from "./logger";

type Condition = "adj" | "read" | "click";

interface IssuelinkPageResult {
	items: CrawlItemType[];
	warnings: CrawlWarning[];
	failure?: CrawlFailure;
}

async function getItemsByCondition(condition: Condition): Promise<IssuelinkPageResult> {
	const url = `https://www.issuelink.co.kr/community/listview/all/12/${condition}/_self/blank/blank/blank`;

	try {
		const response = await fetchWithTimeout(url, {
			cache: "no-store",
			headers: {
				accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
				"cache-control": "no-cache",
				referer: "https://www.issuelink.co.kr/",
				"sec-fetch-dest": "document",
				"sec-fetch-mode": "navigate",
				"sec-fetch-site": "same-origin",
				"upgrade-insecure-requests": "1",
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const html = await response.text();
		const items = parseIssuelinkHtml(html);
		if (items.length === 0) {
			const title = html
				.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
				?.replace(/\s+/g, " ")
				.trim()
				.slice(0, 80);
			return {
				items: [],
				warnings: [],
				failure: {
					url,
					kind: "parser",
					message: `IssueLink response contained no community items (bytes=${html.length}, title=${title || "none"})`,
				},
			};
		}

		debugLog(`[Issuelink] ${condition} 조건 아이템 ${items.length}개 추출 완료`);
		return { items, warnings: [] };
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[Issuelink] ${condition} 조건 크롤링 실패: ${message}`);
		return {
			items: [],
			warnings: [],
			failure: { url, message, kind: "network", timeout: isTimeoutError(error) },
		};
	}
}

export async function crawlIssuelink(): Promise<CrawlSourceResult> {
	const conditions: Condition[] = ["adj", "read", "click"];
	const results: IssuelinkPageResult[] = [];

	for (const condition of conditions) {
		results.push(await getItemsByCondition(condition));
	}

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
	const warnings = results.flatMap((result) => result.warnings);
	const dedupedItems = new Map<string, CrawlItemType>();
	for (const item of results.flatMap((result) => result.items)) {
		if (!dedupedItems.has(item.url)) {
			dedupedItems.set(item.url, item);
		}
	}

	return {
		items: Array.from(dedupedItems.values()),
		attempted: conditions.length,
		succeeded: conditions.length - failures.length,
		failures,
		warnings,
	};
}
