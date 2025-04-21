import type { CrawlItemType } from "@/lib/typeDefs";
import * as cheerio from "cheerio";

type HostConfig = {
    host: string;
    tag: string;
};

const HOST_CONFIGS: Record<string, HostConfig> = {
    "82cook": { host: "https://www.82cook.com", tag: "82cook" },
    "bobae": { host: "https://www.bobaedream.co.kr", tag: "bobae" },
    "clien": { host: "https://www.clien.net", tag: "clien" },
    "etoland": { host: "https://www.etoland.co.kr", tag: "etoland" },
    "fmkorea": { host: "https://www.fmkorea.com", tag: "fmkorea" },
    "humoruniv": { host: "https://www.humoruniv.com", tag: "humoruniv" },
    "instiz": { host: "https://www.instiz.net", tag: "instiz" },
    "inven": { host: "https://www.inven.co.kr", tag: "inven" },
    "mlbpark": { host: "https://www.mlbpark.com", tag: "mlbpark" },
    "ppomppu": { host: "https://www.ppomppu.co.kr", tag: "ppomppu" },
    "ruliweb": { host: "https://www.ruliweb.com", tag: "ruliweb" },
    "slr": { host: "https://www.slrclub.com", tag: "slr" },
    "theqoo": { host: "https://theqoo.net", tag: "theqoo" },
    "todayhumor": { host: "https://www.todayhumor.co.kr", tag: "todayhumor" },
    "ygosu": { host: "https://www.ygosu.com", tag: "ygosu" },
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
    const items = [];

    //add items by 12 hours and adj
    items.push(...(await getItemsByCondition("12", "adj")));

    //add items by 12 hours and read
    items.push(...(await getItemsByCondition("12", "read")));

    //add items by 12 hours and click
    items.push(...(await getItemsByCondition("12", "click")));

    // remove duplicate items
    const uniqueItems = items.filter(
        (item, index, self) =>
            index === self.findIndex((t) => t.url === item.url),
    );

    return uniqueItems;
}

async function getItemsByCondition(
    timeFilter: "3" | "6" | "12" | "24" | "72" | "168" | "336" = "12",
    condition: "adj" | "read" | "comment" | "time" | "click" = "adj",
): Promise<CrawlItemType[]> {
    try {
        const baseUrl = "https://issuelink.co.kr/community/listview/all/";
        const suffix = "/_self/blank/blank/blank";

        const response = await fetch(
            `${baseUrl}${timeFilter}/${condition}${suffix}`,
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const text = await response.text();
        const $ = cheerio.load(text);

        const itemList = $(".table.table-stripped.toggle-arrow-tiny tbody")
            .first()
            .children("tr")
            .map((i, el) => {
                const category = $(el).find("td:nth-child(1) > small").text()
                    .trim();
                const item = $(el).find(
                    "td:nth-child(2) > div.first_title > span > a",
                );
                const title = item.text().trim().replace(/\[[^\[\]]*\]$/, "");
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
            .filter((i, el) => el.url !== "")
            .get();

        // 마지막 항목이 실제 항목이 아닌 경우 제거
        return itemList.slice(0, -1);
    } catch (error) {
        console.error("Error crawling issuelink:", error);
        return [];
    }
}
