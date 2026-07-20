import type { CrawlItemType } from "@/lib/type-defs";
import { parseArcaliveHtml } from "./arcalive-parser";
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

export async function crawlArcalive(): Promise<CrawlSourceResult> {
	debugLog("[Arcalive] 크롤링 시작");

	const target = "https://arca.live/b/iloveanimal?mode=best";
	const targetList = Array.from({ length: 3 }, (_, index) => `${target}&p=${index + 1}`);
	const detectedList: CrawlItemType[][] = [];
	const failures: CrawlFailure[] = [];
	const warnings: CrawlWarning[] = [];
	let succeeded = 0;

	for (let index = 0; index < targetList.length; index += 1) {
		const url = targetList[index];
		debugLog(`[Arcalive] 페이지 ${index + 1} 크롤링 시작`);

		try {
			const response = await fetchWithTimeout(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}

			const outcome = parseArcaliveHtml(await response.text());
			const parsed = adaptParserOutcome(url, outcome);
			warnings.push(...parsed.warnings);
			debugLog(
				`[Arcalive] 페이지 ${index + 1} parser=${outcome.status} candidates=${outcome.candidateCount} valid=${outcome.items.length} discarded=${outcome.discardedCount}`
			);
			if (parsed.failure) {
				failures.push(parsed.failure);
				continue;
			}

			detectedList.push(parsed.items);
			succeeded += 1;
		} catch (error) {
			const message = getErrorMessage(error);
			failures.push({ url, message, kind: "network", timeout: isTimeoutError(error) });
			console.error(`[Arcalive] 페이지 ${index + 1} 크롤링 실패: ${message}`);
		}
	}

	const items = detectedList.flat();
	debugLog(`[Arcalive] 전체 크롤링 완료: 총 ${items.length}개 아이템 수집`);

	return {
		items,
		attempted: targetList.length,
		succeeded,
		failures,
		warnings,
	};
}
