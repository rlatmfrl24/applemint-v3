import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export default async function SignOut() {
	const supabase = await createClient();

	await supabase.auth.signOut();
	redirect("/login");
}
