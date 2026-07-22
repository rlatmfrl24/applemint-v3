import type { CrawlItemType } from "@/lib/type-defs";
import { parseBattlepageHtml } from "./battlepage-parser";
import {
	type CrawlAdapterOptions,
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
	parserObservations: CrawlSourceResult["parserObservations"];
}

const BATTLEPAGE_TARGETS = Array.from({ length: 5 }, (_, index) => [
	`https://v12.battlepage.com/??=Board.Humor.Table&page=${index + 1}`,
	`https://v12.battlepage.com/??=Board.ETC.Table&page=${index + 1}`,
]).flat();

export async function crawlBattlepage(
	options: CrawlAdapterOptions = {}
): Promise<CrawlSourceResult> {
	debugLog("[Battlepage] 크롤링 시작");

	const requestedUrls = new Set(options.urls ?? BATTLEPAGE_TARGETS);
	const targetList = BATTLEPAGE_TARGETS.filter((url) => requestedUrls.has(url));

	const results = await Promise.all(
		targetList.map(async (url, index): Promise<BattlepagePageResult> => {
			try {
				const response = await fetchWithTimeout(url, {
					signal: options.signal,
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
				return { ...parsed, parserObservations: [parsed.observation] };
			} catch (error) {
				const message = getErrorMessage(error);
				console.error(`[Battlepage] URL ${index + 1} 크롤링 실패: ${message}`);
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
	const items = results.flatMap((result) => result.items);
	const warnings = results.flatMap((result) => result.warnings);
	const parserObservations = results.flatMap((result) => result.parserObservations);

	return {
		items,
		attemptedUrls: targetList,
		attempted: targetList.length,
		succeeded: targetList.length - failures.length,
		failures,
		warnings,
		parserObservations,
	};
}
