import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import {
	aggregateCrawlAttempts,
	type CrawlAdapterOptions,
	type CrawlExecutionResult,
	type CrawlSourceResult,
	type CrawlTarget,
} from "./contracts";
import { crawlDogdrip } from "./dogdrip";
import { crawlInsagirl } from "./insagirl";
import { crawlIssueLink } from "./issuelink";
import { debugLog } from "./logger";

type Crawler = (options?: CrawlAdapterOptions) => Promise<CrawlSourceResult>;

const FULL_RETRY_TARGETS = new Set<CrawlTarget>(["arcalive"]);
const NO_RETRY_TARGETS = new Set<CrawlTarget>(["dogdrip"]);

const CRAWLERS: Record<CrawlTarget, Crawler> = {
	arcalive: crawlArcalive,
	battlepage: crawlBattlepage,
	dogdrip: crawlDogdrip,
	insagirl: crawlInsagirl,
	issuelink: crawlIssueLink,
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
	} catch (error) {
		if (NO_RETRY_TARGETS.has(target)) throw error;
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
	if (NO_RETRY_TARGETS.has(target)) {
		debugLog(`[Crawl] ${target} 사이트 정책에 따라 재시도를 생략합니다.`);
		return aggregateCrawlAttempts([firstAttempt]);
	}

	const hasUpstreamChallenge = firstAttempt.failures.some(
		(failure) => failure.kind === "upstream-challenge"
	);
	if (FULL_RETRY_TARGETS.has(target) && hasUpstreamChallenge) {
		debugLog(`[Crawl] ${target} upstream challenge가 포함되어 전체 재시도를 생략합니다.`);
		return aggregateCrawlAttempts([firstAttempt]);
	}

	const retryUrls = Array.from(
		new Set(
			firstAttempt.failures
				.filter((failure) => failure.kind !== "upstream-challenge")
				.map((failure) => failure.url)
		)
	);
	if (retryUrls.length === 0) {
		debugLog(`[Crawl] ${target} 재시도 불가능한 upstream challenge 감지`);
		return aggregateCrawlAttempts([firstAttempt]);
	}

	debugLog(`[Crawl] ${target} 실패 작업 ${retryUrls.length}개, 1000ms 후 선택 재시도`);
	await delay(1000);
	if (options.signal?.aborted) {
		return aggregateCrawlAttempts([firstAttempt]);
	}
	const retryAttempt = await crawler({
		...options,
		urls: FULL_RETRY_TARGETS.has(target) ? undefined : retryUrls,
	});
	return aggregateCrawlAttempts([firstAttempt, retryAttempt]);
}
