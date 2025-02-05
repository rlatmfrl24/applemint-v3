import { redirect } from "next/navigation";
import { NewThreads } from "./new-threads/main";
import { createClient } from "@/utils/supabase/server";

export default async function MainPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex-1 w-full flex flex-col items-center container p-3">
      <NewThreads />
    </div>
  );
}
