import * as cheerio from "cheerio";
import type { CrawlItemType } from "@/lib/type-defs";
import { createParserFailure, createParserSuccess, type ParserOutcome } from "./parser-contracts";

export const DOGDRIP_BASE_URL = "https://www.dogdrip.net";
export const DOGDRIP_MINIMUM_ITEMS = 10;

function parseDogdripUrl(href: string) {
	try {
		const url = new URL(href, DOGDRIP_BASE_URL);
		const match = /^\/dogdrip\/([1-9]\d*)$/.exec(url.pathname);
		if (
			url.protocol !== "https:" ||
			(url.hostname !== "dogdrip.net" && url.hostname !== "www.dogdrip.net") ||
			url.username ||
			url.password ||
			url.port ||
			!match
		) {
			return null;
		}

		return `${DOGDRIP_BASE_URL}/dogdrip/${match[1]}`;
	} catch {
		return null;
	}
}

export function parseDogdripHtml(html: string): ParserOutcome {
	const $ = cheerio.load(html);
	const container = $(".board-list").first();
	if (container.length === 0) {
		return createParserFailure({
			code: "missing-container",
			message: "DogDrip 인기글 목록 컨테이너를 찾지 못했습니다.",
			minimumItems: DOGDRIP_MINIMUM_ITEMS,
		});
	}

	const allRows = container.find("li.webzine");
	const candidates = allRows.filter((_index, element) =>
		Boolean($(element).find("a.ed.title-link[href]").first().attr("href"))
	);
	const candidateCount = candidates.length;
	const ignoredCount = allRows.length - candidateCount;
	if (candidateCount === 0) {
		return createParserFailure({
			code: "unrecognized-empty-state",
			message: "DogDrip 인기글 목록에 인식 가능한 게시물이 없습니다.",
			ignoredCount,
			minimumItems: DOGDRIP_MINIMUM_ITEMS,
		});
	}

	const items: CrawlItemType[] = [];
	const seenUrls = new Set<string>();
	let discardedCount = 0;
	let duplicateCount = 0;
	candidates.each((_index, element) => {
		const link = $(element).find("a.ed.title-link[href]").first();
		const href = link.attr("href");
		const url = href ? parseDogdripUrl(href) : null;
		const title = link.text().replace(/\s+/g, " ").trim();
		if (!url || !title) {
			discardedCount += 1;
			return;
		}
		if (seenUrls.has(url)) {
			duplicateCount += 1;
			return;
		}
		seenUrls.add(url);
		items.push({
			url,
			title,
			description: "",
			host: DOGDRIP_BASE_URL,
			tag: ["dogdrip", "popular"],
		});
	});

	if (items.length === 0) {
		return createParserFailure({
			code: "all-items-invalid",
			message: "DogDrip 게시물 후보가 모두 URL 또는 필수 필드 검증에 실패했습니다.",
			candidateCount,
			discardedCount,
			ignoredCount,
			duplicateCount,
			minimumItems: DOGDRIP_MINIMUM_ITEMS,
		});
	}

	return createParserSuccess({
		items,
		candidateCount,
		discardedCount,
		ignoredCount,
		duplicateCount,
		minimumItems: DOGDRIP_MINIMUM_ITEMS,
		source: "DogDrip",
	});
}
