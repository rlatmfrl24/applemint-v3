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

type HostConfig = {
	host: string;
	tag: string;
};

type Condition = "adj" | "read" | "click";

interface IssuelinkPageResult {
	items: CrawlItemType[];
	failure?: CrawlFailure;
}

const HOST_CONFIGS: Record<string, HostConfig> = {
	"82cook": { host: "https://www.82cook.com", tag: "82cook" },
	bobae: { host: "https://www.bobaedream.co.kr", tag: "bobae" },
	clien: { host: "https://www.clien.net", tag: "clien" },
	etoland: { host: "https://www.etoland.co.kr", tag: "etoland" },
	fmkorea: { host: "https://www.fmkorea.com", tag: "fmkorea" },
	humoruniv: { host: "https://www.humoruniv.com", tag: "humoruniv" },
	instiz: { host: "https://www.instiz.net", tag: "instiz" },
	inven: { host: "https://www.inven.co.kr", tag: "inven" },
	mlbpark: { host: "https://www.mlbpark.com", tag: "mlbpark" },
	ppomppu: { host: "https://www.ppomppu.co.kr", tag: "ppomppu" },
	ruliweb: { host: "https://www.ruliweb.com", tag: "ruliweb" },
	slr: { host: "https://www.slrclub.com", tag: "slr" },
	theqoo: { host: "https://theqoo.net", tag: "theqoo" },
	todayhumor: { host: "https://www.todayhumor.co.kr", tag: "todayhumor" },
	ygosu: { host: "https://www.ygosu.com", tag: "ygosu" },
};

const DEFAULT_HOST_CONFIG: HostConfig = { host: "", tag: "" };

function getHost(url: string): HostConfig {
	if (!url) {
		return DEFAULT_HOST_CONFIG;
	}

	return HOST_CONFIGS[url.split("/")[5] ?? ""] ?? DEFAULT_HOST_CONFIG;
}

async function getItemsByCondition(condition: Condition): Promise<IssuelinkPageResult> {
	const url = `https://issuelink.co.kr/community/listview/all/12/${condition}/_self/blank/blank/blank`;

	try {
		const response = await fetchWithTimeout(url, {
			headers: {
				accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const $ = cheerio.load(await response.text());
		const items = $(".table.table-stripped.toggle-arrow-tiny tbody")
			.first()
			.children("tr")
			.map((_index, element) => {
				const anchor = $(element).find("td:nth-child(2) > div.first_title > span > a");
				const itemUrl = anchor.attr("href") ?? "";
				const host = getHost(itemUrl);

				return {
					url: itemUrl,
					title: anchor
						.text()
						.trim()
						.replace(/\[[^[\]]*\]$/, ""),
					description: "",
					host: host.host,
					tag: ["issuelink", host.tag].filter(Boolean),
				} satisfies CrawlItemType;
			})
			.get()
			.filter((item) => item.url !== "")
			.slice(0, -1);

		debugLog(`[Issuelink] ${condition} 조건 아이템 ${items.length}개 추출 완료`);
		return { items };
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[Issuelink] ${condition} 조건 크롤링 실패: ${message}`);
		return { items: [], failure: { url, message, timeout: isTimeoutError(error) } };
	}
}

export async function crawlIssuelink(): Promise<CrawlSourceResult> {
	const conditions: Condition[] = ["adj", "read", "click"];
	const results: IssuelinkPageResult[] = [];

	for (const condition of conditions) {
		results.push(await getItemsByCondition(condition));
	}

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
	const dedupedItems = new Map<string, CrawlItemType>();
	for (const item of results.flatMap((result) => result.items)) {
		if (!dedupedItems.has(item.url)) {
			dedupedItems.set(item.url, item);
		}
	}

	return {
		items: Array.from(dedupedItems.values()),
		attempted: conditions.length,
		succeeded: conditions.length - failures.length,
		failures,
	};
}
