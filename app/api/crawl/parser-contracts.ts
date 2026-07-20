import type { CrawlItemType } from "@/lib/type-defs";

export type ParserWarningCode = "empty-list" | "below-minimum-items" | "discarded-items";

export type ParserFailureCode =
	| "missing-container"
	| "invalid-payload"
	| "unrecognized-empty-state"
	| "all-items-invalid";

export interface ParserWarning {
	code: ParserWarningCode;
	message: string;
	count: number;
}

export interface ParserFailure {
	code: ParserFailureCode;
	message: string;
}

export interface ParserOutcome {
	status: "ok" | "empty" | "failure";
	items: CrawlItemType[];
	candidateCount: number;
	discardedCount: number;
	warnings: ParserWarning[];
	failure?: ParserFailure;
}

export function createParserSuccess({
	items,
	candidateCount,
	discardedCount,
	minimumItems,
	source,
}: {
	items: CrawlItemType[];
	candidateCount: number;
	discardedCount: number;
	minimumItems: number;
	source: string;
}): ParserOutcome {
	const warnings: ParserWarning[] = [];
	if (discardedCount > 0) {
		warnings.push({
			code: "discarded-items",
			message: `${source} 파서가 필수 조건을 충족하지 못한 항목을 제외했습니다.`,
			count: discardedCount,
		});
	}
	if (items.length < minimumItems) {
		warnings.push({
			code: "below-minimum-items",
			message: `${source} 추출 건수가 최소 기준 ${minimumItems}건보다 적습니다.`,
			count: items.length,
		});
	}

	return {
		status: "ok",
		items,
		candidateCount,
		discardedCount,
		warnings,
	};
}

export function createParserEmpty(source: string): ParserOutcome {
	return {
		status: "empty",
		items: [],
		candidateCount: 0,
		discardedCount: 0,
		warnings: [
			{
				code: "empty-list",
				message: `${source} 응답이 정상적인 빈 목록을 반환했습니다.`,
				count: 0,
			},
		],
	};
}

export function createParserFailure({
	code,
	message,
	candidateCount = 0,
	discardedCount = 0,
}: {
	code: ParserFailureCode;
	message: string;
	candidateCount?: number;
	discardedCount?: number;
}): ParserOutcome {
	return {
		status: "failure",
		items: [],
		candidateCount,
		discardedCount,
		warnings:
			discardedCount > 0
				? [
						{
							code: "discarded-items",
							message: "파서가 모든 후보 항목을 제외했습니다.",
							count: discardedCount,
						},
					]
				: [],
		failure: { code, message },
	};
}
