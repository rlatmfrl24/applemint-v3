import type { CrawlItemType } from "@/lib/type-defs";

type ParserWarningCode =
	| "empty-list"
	| "below-minimum-items"
	| "discarded-items"
	| "high-discard-rate";

type ParserWarningSeverity = "info" | "warning";

export type ParserFailureCode =
	| "missing-container"
	| "invalid-payload"
	| "unrecognized-empty-state"
	| "all-items-invalid";

interface ParserWarning {
	code: ParserWarningCode;
	severity: ParserWarningSeverity;
	message: string;
	count: number;
}

interface ParserFailure {
	code: ParserFailureCode;
	message: string;
}

export interface ParserOutcome {
	status: "ok" | "empty" | "failure";
	items: CrawlItemType[];
	candidateCount: number;
	discardedCount: number;
	ignoredCount: number;
	duplicateCount: number;
	minimumItems: number;
	warnings: ParserWarning[];
	failure?: ParserFailure;
}

export function createParserSuccess({
	items,
	candidateCount,
	discardedCount,
	ignoredCount = 0,
	duplicateCount = 0,
	minimumItems,
	source,
}: {
	items: CrawlItemType[];
	candidateCount: number;
	discardedCount: number;
	ignoredCount?: number;
	duplicateCount?: number;
	minimumItems: number;
	source: string;
}): ParserOutcome {
	const warnings: ParserWarning[] = [];
	if (discardedCount > 0) {
		warnings.push({
			code: "discarded-items",
			severity: "info",
			message: `${source} 파서가 필수 조건을 충족하지 못한 항목을 제외했습니다.`,
			count: discardedCount,
		});
	}
	if (
		candidateCount >= minimumItems &&
		discardedCount > 0 &&
		discardedCount / candidateCount >= 0.5
	) {
		warnings.push({
			code: "high-discard-rate",
			severity: "warning",
			message: `${source} 파서의 후보 제외율이 50% 이상입니다.`,
			count: discardedCount,
		});
	}
	if (items.length < minimumItems) {
		warnings.push({
			code: "below-minimum-items",
			severity: "warning",
			message: `${source} 추출 건수가 최소 기준 ${minimumItems}건보다 적습니다.`,
			count: items.length,
		});
	}

	return {
		status: "ok",
		items,
		candidateCount,
		discardedCount,
		ignoredCount,
		duplicateCount,
		minimumItems,
		warnings,
	};
}

export function createParserEmpty(source: string, minimumItems: number): ParserOutcome {
	return {
		status: "empty",
		items: [],
		candidateCount: 0,
		discardedCount: 0,
		ignoredCount: 0,
		duplicateCount: 0,
		minimumItems,
		warnings: [
			{
				code: "empty-list",
				severity: "info",
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
	ignoredCount = 0,
	duplicateCount = 0,
	minimumItems,
}: {
	code: ParserFailureCode;
	message: string;
	candidateCount?: number;
	discardedCount?: number;
	ignoredCount?: number;
	duplicateCount?: number;
	minimumItems: number;
}): ParserOutcome {
	return {
		status: "failure",
		items: [],
		candidateCount,
		discardedCount,
		ignoredCount,
		duplicateCount,
		minimumItems,
		warnings: [],
		failure: { code, message },
	};
}
