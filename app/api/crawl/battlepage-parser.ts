import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/type-defs";
import {
	createParserEmpty,
	createParserFailure,
	createParserSuccess,
	type ParserOutcome,
} from "./parser-contracts";

const BATTLEPAGE_BASE_URL = "https://v12.battlepage.com";
const ALLOWED_BOARDS = new Set(["Board.Humor.View", "Board.Etc.View"]);
const EMPTY_LIST_TEXT = /검색된 게시물이 없습니다/;

export const BATTLEPAGE_MINIMUM_ITEMS = 5;

function parsePostUrl(href: string) {
	try {
		const url = new URL(href, BATTLEPAGE_BASE_URL);
		const board = url.searchParams.get("?");
		const postNumber = url.searchParams.get("no");
		if (
			url.protocol !== "https:" ||
			url.hostname !== "v12.battlepage.com" ||
			url.pathname !== "/" ||
			!board ||
			!ALLOWED_BOARDS.has(board) ||
			!postNumber ||
			!/^\d+$/.test(postNumber)
		) {
			return null;
		}

		return `${BATTLEPAGE_BASE_URL}/??=${board}&no=${postNumber}`;
	} catch {
		return null;
	}
}

export function parseBattlepageHtml(html: string): ParserOutcome {
	const $ = cheerio.load(html);
	const containers = $(".ListTable");
	if (containers.length === 0) {
		return createParserFailure({
			code: "missing-container",
			message: "Battlepage 목록 container를 찾지 못했습니다.",
			minimumItems: BATTLEPAGE_MINIMUM_ITEMS,
		});
	}

	const candidates = containers.find(".bp_subject[title]");
	const candidateCount = candidates.length;
	if (candidateCount === 0) {
		if (EMPTY_LIST_TEXT.test(containers.text().replace(/\s+/g, " "))) {
			return createParserEmpty("Battlepage", BATTLEPAGE_MINIMUM_ITEMS);
		}

		return createParserFailure({
			code: "unrecognized-empty-state",
			message: "Battlepage 목록은 존재하지만 게시물 또는 공식 빈 목록 표시를 찾지 못했습니다.",
			minimumItems: BATTLEPAGE_MINIMUM_ITEMS,
		});
	}

	const items = new Map<string, CrawlItemType>();
	let discardedCount = 0;
	let duplicateCount = 0;
	candidates.each((_index, element) => {
		const href = $(element).find("a[href]").first().attr("href");
		const title = ($(element).attr("title") ?? "").replace(/\s+/g, " ").trim();
		const url = href ? parsePostUrl(href) : null;
		if (!url || !title) {
			discardedCount += 1;
			return;
		}
		if (items.has(url)) {
			duplicateCount += 1;
			return;
		}

		items.set(url, {
			url,
			title,
			description: "",
			host: BATTLEPAGE_BASE_URL,
			tag: ["battlepage"],
		});
	});

	if (items.size === 0) {
		return createParserFailure({
			code: "all-items-invalid",
			message: "Battlepage 게시물 후보가 모두 URL 또는 필수 필드 검증에 실패했습니다.",
			candidateCount,
			discardedCount,
			duplicateCount,
			minimumItems: BATTLEPAGE_MINIMUM_ITEMS,
		});
	}

	return createParserSuccess({
		items: Array.from(items.values()),
		candidateCount,
		discardedCount,
		duplicateCount,
		minimumItems: BATTLEPAGE_MINIMUM_ITEMS,
		source: "Battlepage",
	});
}
