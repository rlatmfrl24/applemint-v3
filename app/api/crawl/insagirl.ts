import * as linkify from "linkifyjs";
import type { CrawlItemType } from "@/lib/type-defs";
import {
	type CrawlFailure,
	type CrawlSourceResult,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { debugLog } from "./logger";

interface InsagirlPageResult {
	items: CrawlItemType[];
	failure?: CrawlFailure;
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

		const json = (await response.json()) as { v?: unknown };
		if (!Array.isArray(json.v)) {
			throw new Error("Unexpected JSON response shape");
		}

		const items: CrawlItemType[] = [];
		for (const rawItem of json.v) {
			if (typeof rawItem !== "string") {
				continue;
			}

			const segments = rawItem.split("|");
			if (segments[1] === "syncwatch" || !segments[2]) {
				continue;
			}

			const rawString = segments[2];
			const urls = linkify.find(rawString);
			const title = urls
				.reduce((text, detectedUrl) => text.replace(detectedUrl.value, ""), rawString)
				.replace(/\s+/g, " ")
				.trim();

			for (const detectedUrl of urls) {
				try {
					items.push({
						url: detectedUrl.href,
						title,
						description: "",
						host: new URL(detectedUrl.href).hostname,
						tag: ["insagirl"],
					});
				} catch (error) {
					debugLog("[Insagirl] 잘못된 URL 제외", getErrorMessage(error));
				}
			}
		}

		debugLog(`[Insagirl] URL ${index + 1} 아이템 ${items.length}개 추출 완료`);
		return { items };
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[Insagirl] URL ${index + 1} 크롤링 실패: ${message}`);
		return { items: [], failure: { url, message, timeout: isTimeoutError(error) } };
	}
}

export async function crawlInsagirl(): Promise<CrawlSourceResult> {
	const targets = [
		"https://insagirl-hrm.appspot.com/json2/1/1/2/",
		"https://insagirl-hrm.appspot.com/json2/2/1/2/",
	];

	const results = await Promise.all(targets.map(crawlInsagirlTarget));

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
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
	};
}
