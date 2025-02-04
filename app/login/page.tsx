"use client";

import { createClient } from "@/utils/supabase/client";
import { redirect } from "next/navigation";
import { SubmitButton } from "./submit-button";
import { useUserStore } from "@/store/user.store";
import { useCallback } from "react";

export default function Login({
  searchParams,
}: {
  searchParams: { message: string };
}) {
  const userStore = useUserStore();

  // const signIn = async (formData: FormData) => {
  //   const email = formData.get("email") as string;
  //   const password = formData.get("password") as string;

  //   const { error } = await supabase.auth.signInWithPassword({
  //     email,
  //     password,
  //   });

  //   if (error) {
  //     return redirect("/login?message=Could not authenticate user");
  //   }

  //   userStore.setIsUserLoggedIn(true);
  //   userStore.setUser({ email });

  //   return redirect("/");
  // };

  const signIn = useCallback(async () => {
    const supabase = createClient();
    const email = document.querySelector(
      "input[name=email]"
    ) as HTMLInputElement;
    const password = document.querySelector(
      "input[name=password]"
    ) as HTMLInputElement;

    const { error } = await supabase.auth.signInWithPassword({
      email: email.value,
      password: password.value,
    });

    if (error) {
      return redirect(`/login?message=${error.message}`);
    }

    userStore.setIsUserLoggedIn(true);
    userStore.setUser({ email: email.value });

    return redirect("/");
  }, [userStore]);

  return (
    <div className="flex-1 flex flex-col w-full px-8 sm:max-w-md justify-center gap-2">
      <form className="flex-1 flex flex-col w-full justify-center gap-2 text-foreground">
        <label className="text-md" htmlFor="email">
          Email
        </label>
        <input
          className="rounded-md px-4 py-2 bg-inherit border mb-6"
          name="email"
          placeholder="you@example.com"
          required
        />
        <label className="text-md" htmlFor="password">
          Password
        </label>
        <input
          className="rounded-md px-4 py-2 bg-inherit border mb-6"
          type="password"
          name="password"
          placeholder="••••••••"
          required
        />
        <SubmitButton
          formAction={signIn}
          className="bg-green-700 rounded-md px-4 py-2 text-foreground mb-2"
          pendingText="Signing In..."
        >
          Sign In
        </SubmitButton>

        {searchParams?.message && (
          <p className="mt-4 p-4 bg-foreground/10 text-foreground text-center">
            {searchParams.message}
          </p>
        )}
      </form>
    </div>
  );
}
