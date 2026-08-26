import { createBrowserClient } from "@supabase/ssr";
import { getClientEnvironment } from "@/lib/env/client";
import type { Database } from "@/types/database.types";

export function createClient() {
	const environment = getClientEnvironment();

	return createBrowserClient<Database>(
		environment.NEXT_PUBLIC_SUPABASE_URL,
		environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
	);
}
