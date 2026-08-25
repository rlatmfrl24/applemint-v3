import * as cheerio from "cheerio";
import { getIssueLinkCommunityHost } from "@/lib/community";
import type { CrawlItemType } from "@/lib/type-defs";
import { createParserFailure, createParserSuccess, type ParserOutcome } from "./parser-contracts";

export const ISSUELINK_BASE_URL = "https://www.issuelink.co.kr";
export const ISSUELINK_MINIMUM_ITEMS = 15;
export const ISSUELINK_MAX_ITEMS = 20;
export const ISSUELINK_MAX_ITEMS_PER_SOURCE = 3;

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

	const items: CrawlItemType[] = [];
	const seenUrls = new Set<string>();
	const sourceCounts = new Map<string, number>();
	let discardedCount = 0;
	let ignoredCount = 0;
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
		if (seenUrls.has(parsedUrl.url)) {
			duplicateCount += 1;
			return;
		}
		seenUrls.add(parsedUrl.url);

		const sourceCount = sourceCounts.get(parsedUrl.sourceKey) ?? 0;
		if (items.length >= ISSUELINK_MAX_ITEMS || sourceCount >= ISSUELINK_MAX_ITEMS_PER_SOURCE) {
			ignoredCount += 1;
			return;
		}

		items.push({
			url: parsedUrl.url,
			title,
			description: "",
			host: getIssueLinkCommunityHost(parsedUrl.sourceKey) ?? ISSUELINK_BASE_URL,
			tag: ["issuelink", parsedUrl.sourceKey],
		});
		sourceCounts.set(parsedUrl.sourceKey, sourceCount + 1);
	});

	if (items.length === 0) {
		return createParserFailure({
			code: "all-items-invalid",
			message: "IssueLink 게시물 후보가 모두 URL 또는 필수 필드 검증에 실패했습니다.",
			candidateCount,
			discardedCount,
			ignoredCount,
			duplicateCount,
			minimumItems: ISSUELINK_MINIMUM_ITEMS,
		});
	}

	return createParserSuccess({
		items,
		candidateCount,
		discardedCount,
		ignoredCount,
		duplicateCount,
		minimumItems: ISSUELINK_MINIMUM_ITEMS,
		source: "IssueLink",
	});
}
