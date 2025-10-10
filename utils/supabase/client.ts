import { createBrowserClient } from "@supabase/ssr";

function requireEnv(value: string | undefined, key: string) {
	if (!value) {
		throw new Error(
			`${key} is not defined. Check your environment configuration.`,
		);
	}
	return value;
}

export function createClient() {
	const supabaseUrl = requireEnv(
		process.env.NEXT_PUBLIC_SUPABASE_URL,
		"NEXT_PUBLIC_SUPABASE_URL",
	);
	const supabaseAnonKey = requireEnv(
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		"NEXT_PUBLIC_SUPABASE_ANON_KEY",
	);

	return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
