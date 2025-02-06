import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export default async function SignOut() {
  const supabase = createClient();

  await supabase.auth.signOut();
  redirect("/login");
}
