import "server-only";

import { z } from "zod";

const optionalServerEnvironmentSchema = z
	.object({
		CRAWL_INTERNAL_SECRET: z.string().optional(),
		YOUTUBE_API_KEY: z.string().optional(),
		WEB_PUSH_ENABLED: z.string().optional(),
		VAPID_PUBLIC_KEY: z.string().optional(),
		VAPID_PRIVATE_KEY: z.string().optional(),
		VAPID_SUBJECT: z.string().optional(),
		LOG_LEVEL: z.string().optional(),
		DEBUG_CRAWL: z.string().optional(),
	})
	.strict();

export type OptionalServerEnvironment = z.infer<typeof optionalServerEnvironmentSchema>;

function readOptionalEnvironment(environment: Record<string, string | undefined>) {
	return optionalServerEnvironmentSchema.parse({
		CRAWL_INTERNAL_SECRET: environment.CRAWL_INTERNAL_SECRET,
		YOUTUBE_API_KEY: environment.YOUTUBE_API_KEY,
		WEB_PUSH_ENABLED: environment.WEB_PUSH_ENABLED,
		VAPID_PUBLIC_KEY: environment.VAPID_PUBLIC_KEY,
		VAPID_PRIVATE_KEY: environment.VAPID_PRIVATE_KEY,
		VAPID_SUBJECT: environment.VAPID_SUBJECT,
		LOG_LEVEL: environment.LOG_LEVEL,
		DEBUG_CRAWL: environment.DEBUG_CRAWL,
	});
}

export function getInternalSecret(environment: Record<string, string | undefined> = process.env) {
	return readOptionalEnvironment(environment).CRAWL_INTERNAL_SECRET?.trim() || null;
}

export function getYouTubeApiKey(environment: Record<string, string | undefined> = process.env) {
	return readOptionalEnvironment(environment).YOUTUBE_API_KEY?.trim() || null;
}

export function getWebPushEnvironment(
	environment: Record<string, string | undefined> = process.env
): OptionalServerEnvironment {
	return readOptionalEnvironment(environment);
}

export function isCrawlDebugEnabled(environment: Record<string, string | undefined> = process.env) {
	const parsed = readOptionalEnvironment(environment);
	return (
		parsed.DEBUG_CRAWL === "1" ||
		parsed.DEBUG_CRAWL === "true" ||
		parsed.LOG_LEVEL?.toLowerCase() === "debug"
	);
}
