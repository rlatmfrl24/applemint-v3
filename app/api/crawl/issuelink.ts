import type { CrawlItemType } from "@/lib/type-defs";
import {
	type CrawlAdapterOptions,
	type CrawlFailure,
	type CrawlSourceResult,
	type CrawlWarning,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { ISSUELINK_BASE_URL, parseIssueLinkHtml } from "./issuelink-parser";
import { debugLog } from "./logger";
import { adaptParserOutcome } from "./parser-adapter";

export const ISSUELINK_TARGET = `${ISSUELINK_BASE_URL}/community/listview/all/12/adj/_self/blank/blank/blank`;

interface IssueLinkPageResult {
	items: CrawlItemType[];
	warnings: CrawlWarning[];
	failure?: CrawlFailure;
	parserObservations: CrawlSourceResult["parserObservations"];
}

export async function crawlIssueLink(
	options: CrawlAdapterOptions = {}
): Promise<CrawlSourceResult> {
	debugLog("[IssueLink] 크롤링 시작");

	const requestedUrls = new Set(options.urls ?? [ISSUELINK_TARGET]);
	const targetList = requestedUrls.has(ISSUELINK_TARGET) ? [ISSUELINK_TARGET] : [];
	const results = await Promise.all(
		targetList.map(async (url): Promise<IssueLinkPageResult> => {
			try {
				const response = await fetchWithTimeout(url, {
					signal: options.signal,
					cache: "no-store",
					headers: {
						accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						"accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
						"user-agent":
							"Mozilla/5.0 (compatible; ApplemintCrawler/1.0; +https://github.com/rlatmdrms/applemint)",
					},
				});
				if (!response.ok) {
					throw new Error(`HTTP ${response.status} ${response.statusText}`);
				}

				const outcome = parseIssueLinkHtml(await response.text());
				const parsed = adaptParserOutcome(url, outcome);
				debugLog(
					`[IssueLink] parser=${outcome.status} candidates=${outcome.candidateCount} valid=${outcome.items.length} discarded=${outcome.discardedCount}`
				);
				return { ...parsed, parserObservations: [parsed.observation] };
			} catch (error) {
				const message = getErrorMessage(error);
				console.error(`[IssueLink] 크롤링 실패: ${message}`);
				return {
					items: [],
					warnings: [],
					parserObservations: [],
					failure: { url, message, kind: "network", timeout: isTimeoutError(error) },
				};
			}
		})
	);

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
	return {
		items: results.flatMap((result) => result.items),
		attemptedUrls: targetList,
		attempted: targetList.length,
		succeeded: targetList.length - failures.length,
		failures,
		warnings: results.flatMap((result) => result.warnings),
		parserObservations: results.flatMap((result) => result.parserObservations),
	};
}
