"use client";

import { redirect } from "next/navigation";
import { use, useCallback } from "react";
import { createClient } from "@/utils/supabase/client";
import { SubmitButton } from "./submit-button";

export default function Login({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
	const params = use(searchParams);

	const signIn = useCallback(async () => {
		const supabase = createClient();
		const email = document.querySelector("input[name=email]") as HTMLInputElement;
		const password = document.querySelector("input[name=password]") as HTMLInputElement;

		const { error } = await supabase.auth.signInWithPassword({
			email: email.value,
			password: password.value,
		});

		if (error) {
			return redirect(`/login?message=${error.message}`);
		}
		return redirect("/main");
	}, []);

	return (
		<div className="flex w-full flex-1 flex-col justify-center gap-2 px-8 sm:max-w-md">
			<form className="flex w-full flex-1 flex-col justify-center gap-2 text-foreground">
				<label className="text-md" htmlFor="email">
					Email
				</label>
				<input
					className="mb-6 rounded-md border bg-inherit px-4 py-2"
					name="email"
					placeholder="you@example.com"
					required
				/>
				<label className="text-md" htmlFor="password">
					Password
				</label>
				<input
					className="mb-6 rounded-md border bg-inherit px-4 py-2"
					type="password"
					name="password"
					placeholder="••••••••"
					required
				/>
				<SubmitButton
					formAction={signIn}
					className="mb-2 rounded-md bg-green-700 px-4 py-2 text-foreground"
					pendingText="Signing In..."
				>
					Sign In
				</SubmitButton>

				{params?.message && (
					<p className="mt-4 bg-foreground/10 p-4 text-center text-foreground">{params.message}</p>
				)}
			</form>
		</div>
	);
}
