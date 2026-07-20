import type { CrawlItemType } from "@/lib/type-defs";
import { parseBattlepageHtml } from "./battlepage-parser";
import {
	type CrawlFailure,
	type CrawlSourceResult,
	type CrawlWarning,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { debugLog } from "./logger";
import { adaptParserOutcome } from "./parser-adapter";

interface BattlepagePageResult {
	items: CrawlItemType[];
	warnings: CrawlWarning[];
	failure?: CrawlFailure;
}

export async function crawlBattlepage(): Promise<CrawlSourceResult> {
	debugLog("[Battlepage] 크롤링 시작");

	const baseUrl = "https://v12.battlepage.com";
	const targetList = Array.from({ length: 5 }, (_, index) => [
		`${baseUrl}/??=Board.Humor.Table&page=${index + 1}`,
		`${baseUrl}/??=Board.ETC.Table&page=${index + 1}`,
	]).flat();

	const results = await Promise.all(
		targetList.map(async (url, index): Promise<BattlepagePageResult> => {
			try {
				const response = await fetchWithTimeout(url, {
					headers: {
						accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					},
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status} ${response.statusText}`);
				}

				const outcome = parseBattlepageHtml(await response.text());
				const parsed = adaptParserOutcome(url, outcome);
				debugLog(
					`[Battlepage] URL ${index + 1} parser=${outcome.status} candidates=${outcome.candidateCount} valid=${outcome.items.length} discarded=${outcome.discardedCount}`
				);
				return parsed;
			} catch (error) {
				const message = getErrorMessage(error);
				console.error(`[Battlepage] URL ${index + 1} 크롤링 실패: ${message}`);
				return {
					items: [],
					warnings: [],
					failure: { url, message, kind: "network", timeout: isTimeoutError(error) },
				};
			}
		})
	);

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
	const items = results.flatMap((result) => result.items);
	const warnings = results.flatMap((result) => result.warnings);

	return {
		items,
		attempted: targetList.length,
		succeeded: targetList.length - failures.length,
		failures,
		warnings,
	};
}
