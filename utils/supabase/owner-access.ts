import type { AppSupabaseClient } from "@/types/supabase";
import {
	type AuthAccessMetrics,
	checkAuthenticatedAccess,
	type VerifiedClaims,
} from "./auth-access";

export type OwnerAccessResult =
	| { kind: "owner"; claims: VerifiedClaims }
	| { kind: "unauthenticated"; status: 401; message: string }
	| { kind: "forbidden"; status: 403; message: string }
	| { kind: "unavailable"; status: 503; message: string };

export interface OwnerAccessMetrics extends AuthAccessMetrics {
	recordOwnerCheck(durationMs: number, outcome: "succeeded" | "forbidden" | "failed"): void;
}

export async function checkApplemintOwner(
	supabase: AppSupabaseClient,
	metrics?: OwnerAccessMetrics
): Promise<OwnerAccessResult> {
	const authenticatedAccess = await checkAuthenticatedAccess(supabase, metrics);
	if (authenticatedAccess.kind !== "authenticated") return authenticatedAccess;

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
	return { kind: "owner", claims: authenticatedAccess.claims };
}
