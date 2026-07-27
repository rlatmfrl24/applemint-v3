import type { PostgrestError } from "@supabase/supabase-js";
import { type TRPC_ERROR_CODE_KEY, TRPCError } from "@trpc/server";
import { DomainError, unexpectedFailure } from "./domain-error";

const TRPC_CODES: Record<DomainError["code"], TRPC_ERROR_CODE_KEY> = {
	InvalidInput: "BAD_REQUEST",
	Unauthenticated: "UNAUTHORIZED",
	Forbidden: "FORBIDDEN",
	NotFound: "NOT_FOUND",
	StateConflict: "CONFLICT",
	CapacityExceeded: "TOO_MANY_REQUESTS",
	ConfigurationUnavailable: "SERVICE_UNAVAILABLE",
	UpstreamTimeout: "GATEWAY_TIMEOUT",
	UnexpectedFailure: "INTERNAL_SERVER_ERROR",
};

export function mapPostgrestError(error: PostgrestError, fallbackMessage: string): DomainError {
	switch (error.code) {
		case "22023":
			return new DomainError("InvalidInput", "요청 값이 올바르지 않습니다.", {}, error);
		case "P0002":
			return new DomainError("NotFound", "요청한 데이터를 찾을 수 없습니다.", {}, error);
		case "40001":
			return new DomainError(
				"StateConflict",
				"다른 화면에서 상태가 변경되었습니다. 최신 값을 확인해주세요.",
				{},
				error
			);
		case "42501":
			return new DomainError("Forbidden", "Applemint 소유자만 접근할 수 있습니다.", {}, error);
		default:
			return unexpectedFailure(fallbackMessage, error);
	}
}

export function toTRPCError(error: unknown) {
	let cause = error;
	if (error instanceof TRPCError) {
		if (error.cause instanceof DomainError) {
			return new TRPCError({
				code: TRPC_CODES[error.cause.code],
				message: error.cause.message,
				cause: error.cause,
			});
		}
		if (error.code !== "INTERNAL_SERVER_ERROR") return error;
		cause = error.cause ?? error;
	}

	const domainError =
		cause instanceof DomainError ? cause : unexpectedFailure("요청을 처리하지 못했습니다.", cause);

	return new TRPCError({
		code: TRPC_CODES[domainError.code],
		message: domainError.message,
		cause: domainError,
	});
}
