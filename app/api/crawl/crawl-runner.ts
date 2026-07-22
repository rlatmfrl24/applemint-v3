import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import {
	aggregateCrawlAttempts,
	type CrawlAdapterOptions,
	type CrawlExecutionResult,
	type CrawlSourceResult,
	type CrawlTarget,
} from "./contracts";
import { crawlInsagirl } from "./insagirl";
import { debugLog } from "./logger";

type Crawler = (options?: CrawlAdapterOptions) => Promise<CrawlSourceResult>;

const CRAWLERS: Record<CrawlTarget, Crawler> = {
	arcalive: crawlArcalive,
	battlepage: crawlBattlepage,
	insagirl: crawlInsagirl,
};

export async function runCrawlerWithRetry(
	target: CrawlTarget,
	crawler: Crawler = CRAWLERS[target],
	delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds)),
	options: CrawlAdapterOptions = {}
): Promise<CrawlExecutionResult> {
	let firstAttempt: CrawlSourceResult;
	try {
		firstAttempt = await crawler(options);
	} catch {
		debugLog(`[Crawl] ${target} 소스 실행 실패, 1000ms 후 전체 재시도`);
		await delay(1000);
		options.signal?.throwIfAborted();
		const retryAttempt = await crawler(options);
		return aggregateCrawlAttempts([
			{
				items: [],
				attemptedUrls: [],
				attempted: 0,
				succeeded: 0,
				failures: [],
				warnings: [],
				parserObservations: [],
			},
			retryAttempt,
		]);
	}

	if (firstAttempt.failures.length === 0) {
		return aggregateCrawlAttempts([firstAttempt]);
	}

	const retryUrls = Array.from(new Set(firstAttempt.failures.map((failure) => failure.url)));
	debugLog(`[Crawl] ${target} 실패 작업 ${retryUrls.length}개, 1000ms 후 선택 재시도`);
	await delay(1000);
	if (options.signal?.aborted) {
		return aggregateCrawlAttempts([firstAttempt]);
	}
	const retryAttempt = await crawler({ ...options, urls: retryUrls });
	return aggregateCrawlAttempts([firstAttempt, retryAttempt]);
}
