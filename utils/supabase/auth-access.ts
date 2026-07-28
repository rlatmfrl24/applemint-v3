import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnauthenticatedAuthError } from "./auth-error";

export type VerifiedClaims = NonNullable<
	Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>["data"]
>["claims"];

export type AuthenticatedAccessResult =
	| { kind: "authenticated"; claims: VerifiedClaims }
	| { kind: "unauthenticated"; status: 401; message: string }
	| { kind: "unavailable"; status: 503; message: string };

export interface AuthAccessMetrics {
	recordAuthCheck(durationMs: number, outcome: "succeeded" | "unauthenticated" | "failed"): void;
}

export async function checkAuthenticatedAccess(
	supabase: SupabaseClient,
	metrics?: AuthAccessMetrics
): Promise<AuthenticatedAccessResult> {
	const startedAt = performance.now();
	let result: Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>;

	try {
		result = await supabase.auth.getClaims();
	} catch {
		metrics?.recordAuthCheck(performance.now() - startedAt, "failed");
		return {
			kind: "unavailable",
			status: 503,
			message: "인증 상태를 확인할 수 없습니다.",
		};
	}

	if (result.error) {
		if (!isUnauthenticatedAuthError(result.error)) {
			metrics?.recordAuthCheck(performance.now() - startedAt, "failed");
			return {
				kind: "unavailable",
				status: 503,
				message: "인증 상태를 확인할 수 없습니다.",
			};
		}

		metrics?.recordAuthCheck(performance.now() - startedAt, "unauthenticated");
		return {
			kind: "unauthenticated",
			status: 401,
			message: "로그인이 필요한 요청입니다.",
		};
	}

	const claims = result.data?.claims;
	if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) {
		metrics?.recordAuthCheck(performance.now() - startedAt, "unauthenticated");
		return {
			kind: "unauthenticated",
			status: 401,
			message: "로그인이 필요한 요청입니다.",
		};
	}

	metrics?.recordAuthCheck(performance.now() - startedAt, "succeeded");
	return { kind: "authenticated", claims };
}
