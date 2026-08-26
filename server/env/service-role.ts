import "server-only";

import { z } from "zod";

const serviceRoleEnvironmentSchema = z
	.object({
		SUPABASE_URL: z.string().url(),
		SUPABASE_SECRET_KEY: z.string().trim().min(1),
	})
	.strict();

export function getServiceRoleEnvironment(
	environment: Record<string, string | undefined> = process.env
) {
	const parsed = serviceRoleEnvironmentSchema.safeParse({
		SUPABASE_URL: environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL,
		SUPABASE_SECRET_KEY: environment.SUPABASE_SECRET_KEY,
	});
	if (!parsed.success) {
		throw new Error("Service-role Supabase environment configuration is invalid.");
	}
	return parsed.data;
}
