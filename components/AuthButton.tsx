import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { Button } from "./ui/button";
import { ModeToggle } from "./ThemeToggleButton";

export default async function AuthButton() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const signOut = async () => {
    "use server";

    const supabase = createClient();
    await supabase.auth.signOut();
    return redirect("/login");
  };

  return (
    <div className="flex items-center gap-3">
      {user?.email}
      <ModeToggle />
      <form action={signOut}>
        <Button>Logout</Button>
      </form>
    </div>
  );
}
