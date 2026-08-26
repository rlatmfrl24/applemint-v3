import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getServiceRoleEnvironment } from "@/server/env";
import type { Database } from "@/types/database.types";

export function createServiceRoleClient() {
	const environment = getServiceRoleEnvironment();

	return createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});
}
