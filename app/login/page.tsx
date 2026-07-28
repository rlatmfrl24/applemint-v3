"use client";

import { useRouter } from "next/navigation";
import { use, useCallback } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { createClient } from "@/utils/supabase/client";
import { SubmitButton } from "./submit-button";

export default function Login({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
	const params = use(searchParams);
	const router = useRouter();

	const signIn = useCallback(
		async (formData: FormData) => {
			const supabase = createClient();
			const email = formData.get("email");
			const password = formData.get("password");
			if (typeof email !== "string" || typeof password !== "string") {
				router.replace(`/login?message=${encodeURIComponent("이메일과 비밀번호를 입력해주세요.")}`);
				return;
			}

			const { error } = await supabase.auth.signInWithPassword({
				email,
				password,
			});

			if (error) {
				router.replace(`/login?message=${encodeURIComponent(error.message)}`);
				return;
			}
			window.location.assign("/main");
		},
		[router]
	);

	return (
		<div className="flex w-full flex-1 flex-col justify-center gap-2 px-8 sm:max-w-md">
			<form
				action={signIn}
				className="flex w-full flex-1 flex-col justify-center gap-2 text-foreground"
			>
				<div className="mb-10">
					<BrandLogo />
					<div className="mt-3 text-muted-foreground text-sm">
						트렌드 링크를 모으고, 살펴보고, 간결하게 정리하세요.
					</div>
				</div>
				<label className="text-md" htmlFor="email">
					Email
				</label>
				<input
					className="mb-6 rounded-md border bg-inherit px-4 py-2"
					id="email"
					name="email"
					placeholder="you@example.com"
					required
				/>
				<label className="text-md" htmlFor="password">
					Password
				</label>
				<input
					className="mb-6 rounded-md border bg-inherit px-4 py-2"
					id="password"
					type="password"
					name="password"
					placeholder="••••••••"
					required
				/>
				<SubmitButton
					className="mb-2 rounded-md bg-teal-600 px-4 py-2 text-white hover:bg-teal-700 dark:bg-teal-500 dark:text-zinc-950 dark:hover:bg-teal-400"
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
