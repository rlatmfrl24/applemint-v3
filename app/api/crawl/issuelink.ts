import type { CrawlItemType } from "@/lib/typeDefs";
import * as cheerio from "cheerio";

function getHost(url: string) {
    const keyword = url.split("/")[5];

    switch (keyword) {
        case "82cook":
            return {
                host: "https://www.82cook.com",
                tag: "82cook",
            };
        case "bobae":
            return {
                host: "https://www.bobaedream.co.kr",
                tag: "bobae",
            };
        case "clien":
            return {
                host: "https://www.clien.net",
                tag: "clien",
            };
        case "etoland":
            return {
                host: "https://www.etoland.co.kr",
                tag: "etoland",
            };
        case "fmkorea":
            return {
                host: "https://www.fmkorea.com",
                tag: "fmkorea",
            };
        case "humoruniv":
            return {
                host: "https://www.humoruniv.com",
                tag: "humoruniv",
            };
        case "instiz":
            return {
                host: "https://www.instiz.net",
                tag: "instiz",
            };
        case "inven":
            return {
                host: "https://www.inven.co.kr",
                tag: "inven",
            };
        case "mlbpark":
            return {
                host: "https://www.mlbpark.com",
                tag: "mlbpark",
            };
        case "ppomppu":
            return {
                host: "https://www.ppomppu.co.kr",
                tag: "ppomppu",
            };
        case "ruliweb":
            return {
                host: "https://www.ruliweb.com",
                tag: "ruliweb",
            };
        case "slr":
            return {
                host: "https://www.slrclub.com",
                tag: "slr",
            };
        case "theqoo":
            return {
                host: "https://theqoo.net",
                tag: "theqoo",
            };
        case "todayhumor":
            return {
                host: "https://www.todayhumor.co.kr",
                tag: "todayhumor",
            };
        case "ygosu":
            return {
                host: "https://www.ygosu.com",
                tag: "ygosu",
            };
    }
    return {
        host: "",
        tag: "",
    };
}

export async function crawlIssuelink() {
    const baseUrl = "https://issuelink.co.kr/community/listview/all/";
    const timeFilter = "3"; // "3" || "6" || "12" || "24" || "72" || "168" || "336"
    const condition = "adj"; // "adj" || "read" || "comment" || "time" || "click"
    const suffix = "/_self/blank/blank/blank";

    const flatHtml = await fetch(
        `${baseUrl}${timeFilter}/${condition}${suffix}`,
    );
    const text = await flatHtml.text();
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
            const title = item.text().trim()
                .replace(/\[[^\[\]]*\]$/, "");
            const url = item.attr("href");
            const host = getHost(url ?? "");

            return {
                url: url ? url : "",
                title: title,
                description: "",
                host: host.host,
                tag: ["issuelink", host.tag],
            } as CrawlItemType;
        }).filter((i, el) => {
            return el.url !== "";
        });

    return itemList
        // remove last item because it's not a real item
        .slice(0, itemList.length - 1)
        .get();
}
