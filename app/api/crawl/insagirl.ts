import type { CrawlItemType } from "@/lib/type-defs";
import {
	type CrawlFailure,
	type CrawlSourceResult,
	type CrawlWarning,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { parseInsagirlPayload } from "./insagirl-parser";
import { debugLog } from "./logger";
import { adaptParserOutcome } from "./parser-adapter";

interface InsagirlPageResult {
	items: CrawlItemType[];
	warnings: CrawlWarning[];
	failure?: CrawlFailure;
	parserObservations: CrawlSourceResult["parserObservations"];
}

async function crawlInsagirlTarget(url: string, index: number): Promise<InsagirlPageResult> {
	try {
		const response = await fetchWithTimeout(url, {
			headers: {
				accept: "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const responseBody = await response.text();
		let payload: unknown = null;
		try {
			payload = JSON.parse(responseBody) as unknown;
		} catch {
			// 손상된 JSON도 네트워크 오류가 아닌 parser failure로 분류합니다.
		}

		const outcome = parseInsagirlPayload(payload);
		const parsed = adaptParserOutcome(url, outcome);
		debugLog(
			`[Insagirl] URL ${index + 1} parser=${outcome.status} candidates=${outcome.candidateCount} valid=${outcome.items.length} discarded=${outcome.discardedCount}`
		);
		return { ...parsed, parserObservations: [parsed.observation] };
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[Insagirl] URL ${index + 1} 크롤링 실패: ${message}`);
		return {
			items: [],
			warnings: [],
			parserObservations: [],
			failure: { url, message, kind: "network", timeout: isTimeoutError(error) },
		};
	}
}

export async function crawlInsagirl(): Promise<CrawlSourceResult> {
	const targets = [
		"https://insagirl-hrm.appspot.com/json2/1/1/2/",
		"https://insagirl-hrm.appspot.com/json2/2/1/2/",
	];

	const results = await Promise.all(targets.map(crawlInsagirlTarget));

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
	const warnings = results.flatMap((result) => result.warnings);
	const parserObservations = results.flatMap((result) => result.parserObservations);
	const dedupedItems = new Map<string, CrawlItemType>();
	for (const item of results.flatMap((result) => result.items)) {
		if (!dedupedItems.has(item.url)) {
			dedupedItems.set(item.url, item);
		}
	}

	return {
		items: Array.from(dedupedItems.values()),
		attempted: targets.length,
		succeeded: targets.length - failures.length,
		failures,
		warnings,
		parserObservations,
	};
}
