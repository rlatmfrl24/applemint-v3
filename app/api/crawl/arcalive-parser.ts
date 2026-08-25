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

export interface ArcaliveApiPage {
	outcome: ParserOutcome;
	next: Record<string, string> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArticleId(value: unknown) {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
		return String(value);
	}
	if (typeof value === "string" && /^\d+$/.test(value)) {
		return value;
	}
	return null;
}

function parseNextCursor(value: unknown) {
	if (!isRecord(value) || typeof value.before !== "string" || !value.before.trim()) {
		return null;
	}
	if (
		(typeof value.offset !== "string" && typeof value.offset !== "number") ||
		!String(value.offset).trim()
	) {
		return null;
	}
	return { before: value.before, offset: String(value.offset) };
}

function parseArcaliveApiArticle(value: unknown): CrawlItemType | null {
	if (!isRecord(value)) return null;

	const id = parseArticleId(value.id);
	const title = typeof value.title === "string" ? value.title.replace(/\s+/g, " ").trim() : "";
	if (!id || !title || value.mark !== "best") return null;

	const category =
		typeof value.categoryDisplayName === "string" && value.categoryDisplayName.trim()
			? value.categoryDisplayName.trim()
			: typeof value.category === "string" && value.category.trim()
				? value.category.trim()
				: null;
	return {
		url: `${ARCALIVE_BASE_URL}/b/iloveanimal/${id}`,
		title,
		description: "",
		host: ARCALIVE_BASE_URL,
		tag: category ? ["arcalive", category] : ["arcalive"],
	};
}

export function parseArcaliveApiPayload(payload: unknown): ArcaliveApiPage {
	if (!isRecord(payload) || !Array.isArray(payload.articles)) {
		return {
			outcome: createParserFailure({
				code: "invalid-payload",
				message: "Arcalive 앱 API 응답의 articles 배열을 찾지 못했습니다.",
				minimumItems: ARCALIVE_MINIMUM_ITEMS,
			}),
			next: null,
		};
	}

	const next = parseNextCursor(payload.next);
	if (payload.articles.length === 0) {
		return { outcome: createParserEmpty("Arcalive", ARCALIVE_MINIMUM_ITEMS), next };
	}

	const items = new Map<string, CrawlItemType>();
	let discardedCount = 0;
	let duplicateCount = 0;
	for (const article of payload.articles) {
		const item = parseArcaliveApiArticle(article);
		if (!item) {
			discardedCount += 1;
			continue;
		}
		if (items.has(item.url)) {
			duplicateCount += 1;
			continue;
		}
		items.set(item.url, item);
	}

	if (items.size === 0) {
		return {
			outcome: createParserFailure({
				code: "all-items-invalid",
				message: "Arcalive 앱 API 게시물 후보가 모두 필수 필드 검증에 실패했습니다.",
				candidateCount: payload.articles.length,
				discardedCount,
				duplicateCount,
				minimumItems: ARCALIVE_MINIMUM_ITEMS,
			}),
			next,
		};
	}

	return {
		outcome: createParserSuccess({
			items: Array.from(items.values()),
			candidateCount: payload.articles.length,
			discardedCount,
			duplicateCount,
			minimumItems: ARCALIVE_MINIMUM_ITEMS,
			source: "Arcalive",
		}),
		next,
	};
}

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

	const allRows = container.children(".vrow.column[href]");
	const ignoredCount = allRows.filter(".notice, .filtered").length;
	const candidates = allRows.not(".notice, .filtered");
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
	let duplicateCount = 0;
	candidates.each((_index, element) => {
		const href = $(element).attr("href");
		const title = $(element).find(".title").text().replace(/\s+/g, " ").trim();
		const url = href ? parsePostUrl(href) : null;
		if (!url || !title) {
			discardedCount += 1;
			return;
		}
		if (items.has(url)) {
			duplicateCount += 1;
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
			ignoredCount,
			duplicateCount,
			minimumItems: ARCALIVE_MINIMUM_ITEMS,
		});
	}

	return createParserSuccess({
		items: Array.from(items.values()),
		candidateCount,
		discardedCount,
		ignoredCount,
		duplicateCount,
		minimumItems: ARCALIVE_MINIMUM_ITEMS,
		source: "Arcalive",
	});
}
