import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { NewThreads } from "./new-threads/main";

export default async function Index() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/login");
  }

  return (
    <div className="flex-1 w-full flex flex-col items-center container p-3">
      <NewThreads />
    </div>
  );
}
