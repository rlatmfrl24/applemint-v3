import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/typeDefs";
import {
	type CrawlFailure,
	type CrawlSourceResult,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { debugLog } from "./logger";

interface BattlepagePageResult {
	items: CrawlItemType[];
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

				const text = await response.text();
				const $ = cheerio.load(text);
				const mappedItems = $(".ListTable div")
					.map((_itemIndex, element) => {
						const href = $(element).find("a").attr("href");
						if (!href) {
							return null;
						}

						return {
							url: `${baseUrl}${href.replace(/&page=\d+/, "")}`,
							title: $(element).find(".bp_subject").attr("title") ?? "",
							description: "",
							host: baseUrl,
							tag: ["battlepage"],
						} satisfies CrawlItemType;
					})
					.get();
				const items: CrawlItemType[] = mappedItems.flatMap((item) => (item ? [item] : []));

				debugLog(`[Battlepage] URL ${index + 1} 아이템 ${items.length}개 추출 완료`);
				return { items };
			} catch (error) {
				const message = getErrorMessage(error);
				console.error(`[Battlepage] URL ${index + 1} 크롤링 실패: ${message}`);
				return { items: [], failure: { url, message, timeout: isTimeoutError(error) } };
			}
		})
	);

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
	const items = results.flatMap((result) => result.items);

	return {
		items,
		attempted: targetList.length,
		succeeded: targetList.length - failures.length,
		failures,
	};
}
