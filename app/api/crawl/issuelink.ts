import type { CrawlItemType } from "@/lib/typeDefs";
import {
	type CrawlFailure,
	type CrawlSourceResult,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { parseIssuelinkHtml } from "./issuelink-parser";
import { debugLog } from "./logger";

type Condition = "adj" | "read" | "click";

interface IssuelinkPageResult {
	items: CrawlItemType[];
	failure?: CrawlFailure;
}

async function getItemsByCondition(condition: Condition): Promise<IssuelinkPageResult> {
	const url = `https://issuelink.co.kr/community/listview/all/12/${condition}/_self/blank/blank/blank`;

	try {
		const response = await fetchWithTimeout(url, {
			headers: {
				accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const items = parseIssuelinkHtml(await response.text());
		if (items.length === 0) {
			throw new Error("IssueLink response contained no community items");
		}

		debugLog(`[Issuelink] ${condition} 조건 아이템 ${items.length}개 추출 완료`);
		return { items };
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[Issuelink] ${condition} 조건 크롤링 실패: ${message}`);
		return { items: [], failure: { url, message, timeout: isTimeoutError(error) } };
	}
}

export async function crawlIssuelink(): Promise<CrawlSourceResult> {
	const conditions: Condition[] = ["adj", "read", "click"];
	const results: IssuelinkPageResult[] = [];

	for (const condition of conditions) {
		results.push(await getItemsByCondition(condition));
	}

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
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
	};
}
