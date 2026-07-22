import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import {
	aggregateCrawlAttempts,
	type CrawlExecutionResult,
	type CrawlSourceResult,
	type CrawlTarget,
} from "./contracts";
import { crawlInsagirl } from "./insagirl";
import { debugLog } from "./logger";

type Crawler = () => Promise<CrawlSourceResult>;

const CRAWLERS: Record<CrawlTarget, Crawler> = {
	arcalive: crawlArcalive,
	battlepage: crawlBattlepage,
	insagirl: crawlInsagirl,
};

export async function runCrawlerWithRetry(
	target: CrawlTarget,
	crawler: Crawler = CRAWLERS[target],
	delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<CrawlExecutionResult> {
	const attempts: CrawlSourceResult[] = [];

	for (let attempt = 1; attempt <= 2; attempt += 1) {
		const result = await crawler();
		attempts.push(result);
		if (result.succeeded > 0) {
			return aggregateCrawlAttempts(attempts);
		}

		if (attempt < 2) {
			const delayMs = 1000 * 2 ** (attempt - 1);
			debugLog(`[Crawl] ${target} 전체 요청 실패, ${delayMs}ms 후 재시도`);
			await delay(delayMs);
		}
	}

	return aggregateCrawlAttempts(attempts);
}
