import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/type-defs";
import { createParserFailure, createParserSuccess, type ParserOutcome } from "./parser-contracts";

export const ISSUELINK_BASE_URL = "https://www.issuelink.co.kr";
export const ISSUELINK_MINIMUM_ITEMS = 50;

const ISSUELINK_HOSTS: Record<string, string> = {
	"82cook": "https://www.82cook.com",
	bobae: "https://www.bobaedream.co.kr",
	clien: "https://www.clien.net",
	etoland: "https://www.etoland.co.kr",
	fmkorea: "https://www.fmkorea.com",
	humoruniv: "https://www.humoruniv.com",
	instiz: "https://www.instiz.net",
	inven: "https://www.inven.co.kr",
	mlbpark: "https://www.mlbpark.com",
	ppomppu: "https://www.ppomppu.co.kr",
	ruliweb: "https://www.ruliweb.com",
	slr: "https://www.slrclub.com",
	theqoo: "https://theqoo.net",
	todayhumor: "https://www.todayhumor.co.kr",
	ygosu: "https://www.ygosu.com",
};

interface IssueLinkUrl {
	url: string;
	sourceKey: string;
}

function parseIssueLinkUrl(href: string): IssueLinkUrl | null {
	try {
		const url = new URL(href, ISSUELINK_BASE_URL);
		const match = /^\/community\/go\/([^/]+)\/([^/]+)$/.exec(url.pathname);
		if (
			url.protocol !== "https:" ||
			(url.hostname !== "issuelink.co.kr" && url.hostname !== "www.issuelink.co.kr") ||
			url.username ||
			url.password ||
			url.port ||
			!match
		) {
			return null;
		}

		const sourceKey = decodeURIComponent(match[1]).trim().toLowerCase();
		const itemId = decodeURIComponent(match[2]).trim();
		if (!/^[a-z0-9_-]+$/.test(sourceKey) || !/^[a-z0-9_-]+$/i.test(itemId)) {
			return null;
		}

		return {
			url: `${ISSUELINK_BASE_URL}/community/go/${encodeURIComponent(sourceKey)}/${encodeURIComponent(itemId)}`,
			sourceKey,
		};
	} catch {
		return null;
	}
}

export function parseIssueLinkHtml(html: string): ParserOutcome {
	const $ = cheerio.load(html);
	const candidates = $("a[href*='/community/go/']");
	const candidateCount = candidates.length;
	if (candidateCount === 0) {
		return createParserFailure({
			code: "missing-container",
			message: "IssueLink 목록에서 게시물 링크를 찾지 못했습니다.",
			minimumItems: ISSUELINK_MINIMUM_ITEMS,
		});
	}

	const items = new Map<string, CrawlItemType>();
	let discardedCount = 0;
	let duplicateCount = 0;
	candidates.each((_index, element) => {
		const href = $(element).attr("href");
		const parsedUrl = href ? parseIssueLinkUrl(href) : null;
		const titleNode = $(element).clone();
		titleNode.find("small").remove();
		const title = titleNode.text().replace(/\s+/g, " ").trim();
		if (!parsedUrl || !title) {
			discardedCount += 1;
			return;
		}
		if (items.has(parsedUrl.url)) {
			duplicateCount += 1;
			return;
		}

		items.set(parsedUrl.url, {
			url: parsedUrl.url,
			title,
			description: "",
			host: ISSUELINK_HOSTS[parsedUrl.sourceKey] ?? ISSUELINK_BASE_URL,
			tag: ["issuelink", parsedUrl.sourceKey],
		});
	});

	if (items.size === 0) {
		return createParserFailure({
			code: "all-items-invalid",
			message: "IssueLink 게시물 후보가 모두 URL 또는 필수 필드 검증에 실패했습니다.",
			candidateCount,
			discardedCount,
			duplicateCount,
			minimumItems: ISSUELINK_MINIMUM_ITEMS,
		});
	}

	return createParserSuccess({
		items: Array.from(items.values()),
		candidateCount,
		discardedCount,
		duplicateCount,
		minimumItems: ISSUELINK_MINIMUM_ITEMS,
		source: "IssueLink",
	});
}
