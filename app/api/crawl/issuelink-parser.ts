import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/type-defs";

type HostConfig = {
	host: string;
	tag: string;
};

const ISSUELINK_BASE_URL = "https://www.issuelink.co.kr";

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

function getSourceKey(url: URL) {
	const match = url.pathname.match(/^\/community\/go\/([^/]+)\//);
	return match?.[1] ?? null;
}

export function parseIssuelinkHtml(html: string): CrawlItemType[] {
	const $ = cheerio.load(html);
	const items = new Map<string, CrawlItemType>();

	$("a[href]").each((_index, element) => {
		const href = $(element).attr("href");
		if (!href) {
			return;
		}

		let parsedUrl: URL;
		try {
			parsedUrl = new URL(href, ISSUELINK_BASE_URL);
		} catch {
			return;
		}

		if (parsedUrl.hostname !== "issuelink.co.kr" && parsedUrl.hostname !== "www.issuelink.co.kr") {
			return;
		}

		const sourceKey = getSourceKey(parsedUrl);
		if (!sourceKey) {
			return;
		}

		const title = $(element)
			.text()
			.replace(/\s+/g, " ")
			.trim()
			.replace(/\s*\[[^[\]]*\]$/, "");
		if (!title || items.has(parsedUrl.href)) {
			return;
		}

		const host = HOST_CONFIGS[sourceKey] ?? { host: "", tag: sourceKey };
		items.set(parsedUrl.href, {
			url: parsedUrl.href,
			title,
			description: "",
			host: host.host,
			tag: ["issuelink", host.tag].filter(Boolean),
		});
	});

	return Array.from(items.values());
}
