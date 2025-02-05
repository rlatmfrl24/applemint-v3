import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { QuickThreadWrapper } from "./threads";

export default async function QuickPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <QuickThreadWrapper />;
}
