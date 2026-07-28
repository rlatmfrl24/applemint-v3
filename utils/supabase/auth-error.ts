const UNAUTHENTICATED_ERROR_CODES = new Set([
	"bad_jwt",
	"no_authorization",
	"refresh_token_already_used",
	"refresh_token_not_found",
	"session_expired",
	"session_not_found",
	"user_not_found",
]);

interface AuthErrorLike {
	code?: unknown;
	name?: unknown;
	status?: unknown;
}

export function isUnauthenticatedAuthError(error: unknown) {
	if (!error || typeof error !== "object") return false;

	const { code, name, status } = error as AuthErrorLike;
	return (
		name === "AuthSessionMissingError" ||
		name === "AuthInvalidJwtError" ||
		(typeof code === "string" && UNAUTHENTICATED_ERROR_CODES.has(code)) ||
		status === 401
	);
}
