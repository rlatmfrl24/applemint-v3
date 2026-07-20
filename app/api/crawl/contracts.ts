import type { CrawlItemType } from "@/lib/type-defs";

const CRAWL_TARGETS = ["arcalive", "battlepage", "insagirl", "issuelink"] as const;

export type CrawlTarget = (typeof CRAWL_TARGETS)[number];

export interface CrawlFailure {
	url: string;
	message: string;
	kind: "network" | "parser";
	timeout?: boolean;
}

export interface CrawlWarning {
	url: string;
	code: "empty-list" | "below-minimum-items" | "discarded-items";
	message: string;
	count: number;
}

export interface CrawlSourceResult {
	items: CrawlItemType[];
	attempted: number;
	succeeded: number;
	failures: CrawlFailure[];
	warnings: CrawlWarning[];
}

export function isCrawlTarget(value: unknown): value is CrawlTarget {
	return typeof value === "string" && CRAWL_TARGETS.some((target) => target === value);
}

export function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Unknown error";
}

export function isTimeoutError(error: unknown) {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
