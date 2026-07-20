import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnerAccessResult =
	| { kind: "owner" }
	| { kind: "unauthenticated"; status: 401; message: string }
	| { kind: "forbidden"; status: 403; message: string }
	| { kind: "unavailable"; status: 503; message: string };

export async function checkApplemintOwner(supabase: SupabaseClient): Promise<OwnerAccessResult> {
	const {
		data: { user },
		error: userError,
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return {
			kind: "unauthenticated",
			status: 401,
			message: "로그인이 필요한 요청입니다.",
		};
	}

	const { data: isOwner, error: ownerError } = await supabase.rpc("is_applemint_owner");
	if (ownerError) {
		return {
			kind: "unavailable",
			status: 503,
			message: "소유자 권한을 확인할 수 없습니다.",
		};
	}

	if (isOwner !== true) {
		return {
			kind: "forbidden",
			status: 403,
			message: "Applemint 소유자만 접근할 수 있습니다.",
		};
	}

	return { kind: "owner" };
}
