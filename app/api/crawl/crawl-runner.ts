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
import { crawlIssueLink } from "./issuelink";
import { debugLog } from "./logger";

type Crawler = (options?: CrawlAdapterOptions) => Promise<CrawlSourceResult>;

const FULL_RETRY_TARGETS = new Set<CrawlTarget>(["arcalive"]);

const CRAWLERS: Record<CrawlTarget, Crawler> = {
	arcalive: crawlArcalive,
	battlepage: crawlBattlepage,
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
	debugLog("[crawl] source_attempt_started", {
		requestId: options.requestId,
		runId: options.runId,
		target,
		attempt: 1,
	});
	try {
		firstAttempt = await crawler(options);
	} catch {
		debugLog("[crawl] source_attempt_retry", {
			requestId: options.requestId,
			runId: options.runId,
			target,
			attempt: 2,
			reason: "source-threw",
		});
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

	const hasUpstreamChallenge = firstAttempt.failures.some(
		(failure) => failure.kind === "upstream-challenge"
	);
	if (FULL_RETRY_TARGETS.has(target) && hasUpstreamChallenge) {
		debugLog("[crawl] source_retry_skipped", {
			requestId: options.requestId,
			runId: options.runId,
			target,
			reason: "upstream-challenge",
		});
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
		debugLog("[crawl] source_retry_skipped", {
			requestId: options.requestId,
			runId: options.runId,
			target,
			reason: "no-retryable-url",
		});
		return aggregateCrawlAttempts([firstAttempt]);
	}

	debugLog("[crawl] source_attempt_retry", {
		requestId: options.requestId,
		runId: options.runId,
		target,
		attempt: 2,
		retryUrlCount: retryUrls.length,
		reason: "retryable-failures",
	});
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
