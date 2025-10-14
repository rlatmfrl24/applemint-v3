import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/typeDefs";

type HostConfig = {
	host: string;
	tag: string;
};

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

const DEFAULT_HOST_CONFIG: HostConfig = {
	host: "",
	tag: "",
};

function getHost(url: string): HostConfig {
	if (!url) return DEFAULT_HOST_CONFIG;

	const keyword = url.split("/")[5];
	return HOST_CONFIGS[keyword] || DEFAULT_HOST_CONFIG;
}

export async function crawlIssuelink(): Promise<CrawlItemType[]> {
	console.log("[Issuelink] 크롤링 시작");

	const items = [];

	try {
		//add items by 12 hours and adj
		console.log("[Issuelink] 12시간 추천순 아이템 수집 시작");
		const adjItems = await getItemsByCondition("12", "adj");
		items.push(...adjItems);
		console.log(`[Issuelink] 12시간 추천순 아이템 ${adjItems.length}개 수집 완료`);

		//add items by 12 hours and read
		console.log("[Issuelink] 12시간 조회순 아이템 수집 시작");
		const readItems = await getItemsByCondition("12", "read");
		items.push(...readItems);
		console.log(`[Issuelink] 12시간 조회순 아이템 ${readItems.length}개 수집 완료`);

		//add items by 12 hours and click
		console.log("[Issuelink] 12시간 클릭순 아이템 수집 시작");
		const clickItems = await getItemsByCondition("12", "click");
		items.push(...clickItems);
		console.log(`[Issuelink] 12시간 클릭순 아이템 ${clickItems.length}개 수집 완료`);

		console.log(`[Issuelink] 전체 수집된 아이템 개수 (중복 포함): ${items.length}`);

		// remove duplicate items
		const uniqueItems = items.filter(
			(item, index, self) => index === self.findIndex((t) => t.url === item.url)
		);

		console.log(`[Issuelink] 중복 제거 후 최종 아이템 개수: ${uniqueItems.length}`);
		console.log("[Issuelink] 크롤링 완료");

		return uniqueItems;
	} catch (error) {
		console.error("[Issuelink] 크롤링 중 치명적 에러 발생:", error);
		console.error(
			"[Issuelink] 에러 스택:",
			error instanceof Error ? error.stack : "Stack not available"
		);
		throw error; // 상위로 에러 전파
	}
}

async function getItemsByCondition(
	timeFilter: "3" | "6" | "12" | "24" | "72" | "168" | "336" = "12",
	condition: "adj" | "read" | "comment" | "time" | "click" = "adj"
): Promise<CrawlItemType[]> {
	const baseUrl = "https://issuelink.co.kr/community/listview/all/";
	const suffix = "/_self/blank/blank/blank";
	const url = `${baseUrl}${timeFilter}/${condition}${suffix}`;

	console.log(`[Issuelink] ${timeFilter}시간 ${condition}순 크롤링 시작: ${url}`);

	try {
		const response = await fetch(url, {
			headers: {
				accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
		});

		//request 헤더 출력
		console.log(response.headers);

		console.log(`[Issuelink] ${timeFilter}시간 ${condition}순 응답 상태: ${response.status}`);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const text = await response.text();
		console.log(`[Issuelink] ${timeFilter}시간 ${condition}순 HTML 길이: ${text.length} 문자`);

		const $ = cheerio.load(text);
		console.log(`[Issuelink] ${timeFilter}시간 ${condition}순 HTML 파싱 완료`);

		const itemList = $(".table.table-stripped.toggle-arrow-tiny tbody")
			.first()
			.children("tr")
			.map((_i, el) => {
				const item = $(el).find("td:nth-child(2) > div.first_title > span > a");
				const title = item
					.text()
					.trim()
					.replace(/\[[^[\]]*\]$/, "");
				const url = item.attr("href");
				const host = getHost(url ?? "");

				return {
					url: url ?? "",
					title,
					description: "",
					host: host.host,
					tag: ["issuelink", host.tag].filter(Boolean),
				} as CrawlItemType;
			})
			.filter((_i, el) => el.url !== "")
			.get();

		// 마지막 항목이 실제 항목이 아닌 경우 제거
		const finalItems = itemList.slice(0, -1);
		console.log(
			`[Issuelink] ${timeFilter}시간 ${condition}순 아이템 ${finalItems.length}개 추출 완료`
		);

		// 추출된 아이템들의 제목 로그 (디버깅용)
		finalItems.forEach((item, itemIndex) => {
			if (item.title) {
				console.log(
					`[Issuelink] ${timeFilter}시간 ${condition}순 아이템 ${itemIndex + 1}: ${item.title}`
				);
			}
		});

		return finalItems;
	} catch (error) {
		console.error(`[Issuelink] ${timeFilter}시간 ${condition}순 크롤링 중 에러 발생:`, error);
		console.error(`[Issuelink] 에러 URL: ${url}`);
		console.error(
			"[Issuelink] 에러 스택:",
			error instanceof Error ? error.stack : "Stack not available"
		);
		return [];
	}
}
