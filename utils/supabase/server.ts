import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(value: string | undefined, key: string) {
	if (!value) {
		throw new Error(
			`${key} is not defined. Check your environment configuration.`,
		);
	}
	return value;
}

export const createClient = async () => {
	const cookieStore = await cookies();
	const supabaseUrl = requireEnv(
		process.env.NEXT_PUBLIC_SUPABASE_URL,
		"NEXT_PUBLIC_SUPABASE_URL",
	);
	const supabaseAnonKey = requireEnv(
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		"NEXT_PUBLIC_SUPABASE_ANON_KEY",
	);

	return createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			get(name: string) {
				return cookieStore.get(name)?.value;
			},
			set(name: string, value: string, options: CookieOptions) {
				try {
					cookieStore.set({ name, value, ...options });
				} catch (_error) {
					// The `set` method was called from a Server Component.
					// This can be ignored if you have middleware refreshing
					// user sessions.
				}
			},
			remove(name: string, options: CookieOptions) {
				try {
					cookieStore.set({ name, value: "", ...options });
				} catch (_error) {
					// The `delete` method was called from a Server Component.
					// This can be ignored if you have middleware refreshing
					// user sessions.
				}
			},
		},
	});
};
