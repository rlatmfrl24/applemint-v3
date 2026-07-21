import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/type-defs";
import {
	createParserEmpty,
	createParserFailure,
	createParserSuccess,
	type ParserOutcome,
} from "./parser-contracts";

const ARCALIVE_BASE_URL = "https://arca.live";
const ARCALIVE_POST_PATH = /^\/b\/iloveanimal\/\d+$/;
const EMPTY_LIST_TEXT = /(?:게시물|등록된 글|검색 결과)(?:이|가)?\s*없(?:습니다|어요)/;

export const ARCALIVE_MINIMUM_ITEMS = 10;

function parsePostUrl(href: string) {
	try {
		const url = new URL(href, ARCALIVE_BASE_URL);
		if (
			url.protocol !== "https:" ||
			url.hostname !== "arca.live" ||
			!ARCALIVE_POST_PATH.test(url.pathname)
		) {
			return null;
		}

		url.search = "";
		url.hash = "";
		return url.href;
	} catch {
		return null;
	}
}

export function parseArcaliveHtml(html: string): ParserOutcome {
	const $ = cheerio.load(html);
	const container = $(".list-table.table").first();
	if (container.length === 0) {
		return createParserFailure({
			code: "missing-container",
			message: "Arcalive 목록 container를 찾지 못했습니다.",
			minimumItems: ARCALIVE_MINIMUM_ITEMS,
		});
	}

	const candidates = container.children(".vrow.column[href]");
	const candidateCount = candidates.length;
	if (candidateCount === 0) {
		if (EMPTY_LIST_TEXT.test(container.text().replace(/\s+/g, " "))) {
			return createParserEmpty("Arcalive", ARCALIVE_MINIMUM_ITEMS);
		}

		return createParserFailure({
			code: "unrecognized-empty-state",
			message: "Arcalive 목록은 존재하지만 게시물 또는 공식 빈 목록 표시를 찾지 못했습니다.",
			minimumItems: ARCALIVE_MINIMUM_ITEMS,
		});
	}

	const items = new Map<string, CrawlItemType>();
	let discardedCount = 0;
	candidates.each((_index, element) => {
		const href = $(element).attr("href");
		const title = $(element).find(".title").text().replace(/\s+/g, " ").trim();
		const url = href ? parsePostUrl(href) : null;
		if (!url || !title || items.has(url)) {
			discardedCount += 1;
			return;
		}

		const badge = $(element)
			.find(".vrow-top .col-title .badges")
			.text()
			.replace(/\s+/g, " ")
			.trim();
		items.set(url, {
			url,
			title,
			description: "",
			host: ARCALIVE_BASE_URL,
			tag: badge ? ["arcalive", badge] : ["arcalive"],
		});
	});

	if (items.size === 0) {
		return createParserFailure({
			code: "all-items-invalid",
			message: "Arcalive 게시물 후보가 모두 URL 또는 필수 필드 검증에 실패했습니다.",
			candidateCount,
			discardedCount,
			minimumItems: ARCALIVE_MINIMUM_ITEMS,
		});
	}

	return createParserSuccess({
		items: Array.from(items.values()),
		candidateCount,
		discardedCount,
		minimumItems: ARCALIVE_MINIMUM_ITEMS,
		source: "Arcalive",
	});
}
