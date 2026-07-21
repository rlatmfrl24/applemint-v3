import * as linkify from "linkifyjs";
import type { CrawlItemType } from "@/lib/type-defs";
import {
	createParserEmpty,
	createParserFailure,
	createParserSuccess,
	type ParserOutcome,
} from "./parser-contracts";

export const INSAGIRL_MINIMUM_ITEMS = 20;

function parseDetectedUrl(href: string) {
	try {
		const url = new URL(href);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
			return null;
		}

		url.hash = "";
		return url;
	} catch {
		return null;
	}
}

function collectRecordItems(rawItem: unknown, items: Map<string, CrawlItemType>) {
	if (typeof rawItem !== "string") {
		return { candidateCount: 0, discardedCount: 1, nonSyncRecordCount: 1 };
	}

	const segments = rawItem.split("|");
	if (segments[1] === "syncwatch") {
		return { candidateCount: 0, discardedCount: 0, nonSyncRecordCount: 0 };
	}

	const rawString = segments.slice(2).join("|").trim();
	if (!rawString) {
		return { candidateCount: 0, discardedCount: 1, nonSyncRecordCount: 1 };
	}

	const detectedUrls = linkify.find(rawString);
	const title = detectedUrls
		.reduce((text, detectedUrl) => text.replace(detectedUrl.value, ""), rawString)
		.replace(/\s+/g, " ")
		.trim();
	let discardedCount = 0;
	for (const detectedUrl of detectedUrls) {
		const url = parseDetectedUrl(detectedUrl.href);
		if (!url || !title || items.has(url.href)) {
			discardedCount += 1;
			continue;
		}

		items.set(url.href, {
			url: url.href,
			title,
			description: "",
			host: url.hostname,
			tag: ["insagirl"],
		});
	}

	return {
		candidateCount: detectedUrls.length,
		discardedCount,
		nonSyncRecordCount: 1,
	};
}

export function parseInsagirlPayload(payload: unknown): ParserOutcome {
	if (!payload || typeof payload !== "object" || !("v" in payload) || !Array.isArray(payload.v)) {
		return createParserFailure({
			code: "invalid-payload",
			message: "Insagirl 응답의 v 배열을 찾지 못했습니다.",
			minimumItems: INSAGIRL_MINIMUM_ITEMS,
		});
	}

	if (payload.v.length === 0) {
		return createParserEmpty("Insagirl", INSAGIRL_MINIMUM_ITEMS);
	}

	const items = new Map<string, CrawlItemType>();
	let candidateCount = 0;
	let discardedCount = 0;
	let nonSyncRecordCount = 0;

	for (const rawItem of payload.v) {
		const metrics = collectRecordItems(rawItem, items);
		candidateCount += metrics.candidateCount;
		discardedCount += metrics.discardedCount;
		nonSyncRecordCount += metrics.nonSyncRecordCount;
	}

	if (nonSyncRecordCount === 0) {
		return createParserEmpty("Insagirl", INSAGIRL_MINIMUM_ITEMS);
	}

	if (items.size === 0) {
		return createParserFailure({
			code: "all-items-invalid",
			message: "Insagirl 게시물 후보가 모두 URL 또는 필수 필드 검증에 실패했습니다.",
			candidateCount,
			discardedCount,
			minimumItems: INSAGIRL_MINIMUM_ITEMS,
		});
	}

	return createParserSuccess({
		items: Array.from(items.values()),
		candidateCount,
		discardedCount,
		minimumItems: INSAGIRL_MINIMUM_ITEMS,
		source: "Insagirl",
	});
}
