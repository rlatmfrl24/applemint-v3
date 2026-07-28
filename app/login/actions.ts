"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

const SIGN_OUT_FAILED_MESSAGE = "로그아웃을 완료하지 못했습니다. 다시 시도해주세요.";

export async function signOutCurrentSession() {
	const supabase = await createClient();
	const { error } = await supabase.auth.signOut({ scope: "local" });

	if (error) {
		console.error({
			transport: "server-action",
			operation: "auth.signOut",
			outcome: "failed",
			errorCode: error.code ?? "auth-signout-failed",
		});
		redirect(`/login?message=${encodeURIComponent(SIGN_OUT_FAILED_MESSAGE)}`);
	}

	redirect("/login");
}
