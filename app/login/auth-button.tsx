import { Button } from "../../components/ui/button";
import { ModeToggle } from "../../components/ThemeToggleButton";
import { redirect, useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/server";
import Link from "next/link";

export default async function AuthButton() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex items-center gap-3">
      <p className="invisible w-0 sm:visible sm:w-fit">{user?.email}</p>
      <ModeToggle />
      {user && (
        <Link href="/signout" passHref>
          <Button>Sign Out</Button>
        </Link>
      )}
    </div>
  );
}
