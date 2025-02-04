"use client";

import { Button } from "../components/ui/button";
import { ModeToggle } from "../components/ThemeToggleButton";
import { createClient } from "@/utils/supabase/client";
import { useUserStore } from "@/store/user.store";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthButton() {
  const supabase = createClient();
  const userStore = useUserStore();
  const router = useRouter();

  useEffect(() => {
    // get user from supabase then set it to the store
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        userStore.setUser(user);
        userStore.setIsUserLoggedIn(true);
      } else {
        userStore.setUser(null);
        userStore.setIsUserLoggedIn(false);
      }
    });
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("🚀 ~ signOut ~ error", error);
      return;
    }
    userStore.setUser(null);
    userStore.setIsUserLoggedIn(false);
    router.push("/login");
  }, [supabase, userStore]);

  return (
    <div className="flex items-center gap-3">
      <p className="invisible w-0 sm:visible sm:w-fit">
        {userStore.user?.email}
      </p>
      <ModeToggle />
      {userStore.isUserLoggedIn && (
        <Button className="bg-red-500 text-foreground" onClick={signOut}>
          Logout
        </Button>
      )}
    </div>
  );
}
