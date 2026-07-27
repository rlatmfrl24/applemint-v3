import type { CrawlPolicySettings } from "@/contracts/crawl-policy.schema";

export type DomainErrorCode =
	| "InvalidInput"
	| "Unauthenticated"
	| "Forbidden"
	| "NotFound"
	| "StateConflict"
	| "CapacityExceeded"
	| "ConfigurationUnavailable"
	| "UpstreamTimeout"
	| "UnexpectedFailure";

export interface DomainErrorData {
	latestSettings?: CrawlPolicySettings;
	retryAfterSeconds?: number;
	reasonCode?: string;
	resource?: string;
	requestId?: string;
}

export class DomainError extends Error {
	readonly code: DomainErrorCode;
	readonly data: DomainErrorData;

	constructor(code: DomainErrorCode, message: string, data: DomainErrorData = {}, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "DomainError";
		this.code = code;
		this.data = data;
	}
}

export function unexpectedFailure(message: string, cause?: unknown) {
	return new DomainError("UnexpectedFailure", message, {}, cause);
}
