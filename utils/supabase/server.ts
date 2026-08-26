import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getClientEnvironment } from "@/lib/env/client";
import type { Database } from "@/types/database.types";

export const createClient = async () => {
	const cookieStore = await cookies();
	const environment = getClientEnvironment();

	return createServerClient<Database>(
		environment.NEXT_PUBLIC_SUPABASE_URL,
		environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
		{
			cookies: {
				getAll() {
					return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
				},
				setAll(cookiesToSet) {
					try {
						for (const cookie of cookiesToSet) {
							cookieStore.set(cookie.name, cookie.value, cookie.options);
						}
					} catch (_error) {
						// `setAll` was called from a Server Component.
						// This can be ignored if you have middleware refreshing
						// user sessions.
					}
				},
			},
		}
	);
};
