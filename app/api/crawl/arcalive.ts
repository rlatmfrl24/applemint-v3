import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/type-defs";
import {
	type CrawlFailure,
	type CrawlSourceResult,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { debugLog } from "./logger";

export async function crawlArcalive(): Promise<CrawlSourceResult> {
	debugLog("[Arcalive] 크롤링 시작");

	const baseUrl = "https://arca.live";
	const target = "https://arca.live/b/iloveanimal?mode=best";
	const targetList = Array.from({ length: 3 }, (_, index) => `${target}&p=${index + 1}`);
	const detectedList: CrawlItemType[][] = [];
	const failures: CrawlFailure[] = [];
	let succeeded = 0;

	for (let index = 0; index < targetList.length; index += 1) {
		const url = targetList[index];
		debugLog(`[Arcalive] 페이지 ${index + 1} 크롤링 시작`);

		try {
			const response = await fetchWithTimeout(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}

			const text = await response.text();
			const $ = cheerio.load(text);
			const items = $(".list-table.table")
				.children(".vrow.column")
				.filter((_itemIndex, element) => {
					return (
						$(element).attr("href") !== undefined && $(element).find(".title").text().trim() !== ""
					);
				})
				.map((_itemIndex, element) => {
					const badge = $(element)
						.find(".vrow-inner .vrow-top .vcol.col-title .badges")
						.text()
						.trim();
					const href = $(element).attr("href") ?? "";

					return {
						url: `${baseUrl}${href.replace(/\?mode=best&p=\d+/, "")}`,
						title: $(element).find(".title").text().trim(),
						description: "",
						host: baseUrl,
						tag: badge ? ["arcalive", badge] : ["arcalive"],
					} satisfies CrawlItemType;
				})
				.get();

			detectedList.push(items);
			succeeded += 1;
			debugLog(`[Arcalive] 페이지 ${index + 1} 아이템 ${items.length}개 추출 완료`);
		} catch (error) {
			const message = getErrorMessage(error);
			failures.push({ url, message, timeout: isTimeoutError(error) });
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
	};
}
