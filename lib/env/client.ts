import { z } from "zod";

const clientEnvironmentSchema = z
	.object({
		NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
	})
	.strict();

export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;

export function getClientEnvironment(
	environment: Record<string, string | undefined> = {
		NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	}
): ClientEnvironment {
	const parsed = clientEnvironmentSchema.safeParse(environment);
	if (!parsed.success) {
		throw new Error("Public Supabase environment configuration is invalid.");
	}
	return parsed.data;
}
