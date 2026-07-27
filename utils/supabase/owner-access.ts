import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnauthenticatedAuthError } from "./auth-error";

export type OwnerAccessResult =
	| { kind: "owner" }
	| { kind: "unauthenticated"; status: 401; message: string }
	| { kind: "forbidden"; status: 403; message: string }
	| { kind: "unavailable"; status: 503; message: string };

export interface OwnerAccessMetrics {
	recordAuthCheck(durationMs: number, outcome: "succeeded" | "unauthenticated" | "failed"): void;
	recordOwnerCheck(durationMs: number, outcome: "succeeded" | "forbidden" | "failed"): void;
}

export async function checkApplemintOwner(
	supabase: SupabaseClient,
	metrics?: OwnerAccessMetrics
): Promise<OwnerAccessResult> {
	const authStartedAt = performance.now();
	let user: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>["data"]["user"];
	let userError: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>["error"];
	try {
		const result = await supabase.auth.getUser();
		user = result.data.user;
		userError = result.error;
	} catch {
		metrics?.recordAuthCheck(performance.now() - authStartedAt, "failed");
		return {
			kind: "unavailable",
			status: 503,
			message: "인증 상태를 확인할 수 없습니다.",
		};
	}

	if (userError) {
		if (!isUnauthenticatedAuthError(userError)) {
			metrics?.recordAuthCheck(performance.now() - authStartedAt, "failed");
			return {
				kind: "unavailable",
				status: 503,
				message: "인증 상태를 확인할 수 없습니다.",
			};
		}
		metrics?.recordAuthCheck(performance.now() - authStartedAt, "unauthenticated");
		return {
			kind: "unauthenticated",
			status: 401,
			message: "로그인이 필요한 요청입니다.",
		};
	}
	if (!user) {
		metrics?.recordAuthCheck(performance.now() - authStartedAt, "unauthenticated");
		return {
			kind: "unauthenticated",
			status: 401,
			message: "로그인이 필요한 요청입니다.",
		};
	}
	metrics?.recordAuthCheck(performance.now() - authStartedAt, "succeeded");

	const ownerStartedAt = performance.now();
	let isOwner: unknown;
	let ownerError: unknown;
	try {
		const result = await supabase.rpc("is_applemint_owner");
		isOwner = result.data;
		ownerError = result.error;
	} catch {
		metrics?.recordOwnerCheck(performance.now() - ownerStartedAt, "failed");
		return {
			kind: "unavailable",
			status: 503,
			message: "소유자 권한을 확인할 수 없습니다.",
		};
	}
	if (ownerError) {
		metrics?.recordOwnerCheck(performance.now() - ownerStartedAt, "failed");
		return {
			kind: "unavailable",
			status: 503,
			message: "소유자 권한을 확인할 수 없습니다.",
		};
	}

	if (isOwner !== true) {
		metrics?.recordOwnerCheck(performance.now() - ownerStartedAt, "forbidden");
		return {
			kind: "forbidden",
			status: 403,
			message: "Applemint 소유자만 접근할 수 있습니다.",
		};
	}

	metrics?.recordOwnerCheck(performance.now() - ownerStartedAt, "succeeded");
	return { kind: "owner" };
}
