import { createClient } from "@supabase/supabase-js";

function requireServerEnv(value: string | undefined, key: string) {
	if (!value) {
		throw new Error(`${key} is not defined. Check your server environment configuration.`);
	}
	return value;
}

export function createServiceRoleClient() {
	const supabaseUrl = requireServerEnv(
		process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
		"SUPABASE_URL"
	);
	const serviceRoleKey = requireServerEnv(
		process.env.SUPABASE_SERVICE_ROLE_KEY,
		"SUPABASE_SERVICE_ROLE_KEY"
	);

	return createClient(supabaseUrl, serviceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});
}
