import { z } from "zod";
import { crawlPolicySettingsSchema } from "./crawl-policy.schema";

export const publicErrorDataSchema = z.object({
	requestId: z.string().min(1),
	latestSettings: crawlPolicySettingsSchema.nullable(),
	retryAfterSeconds: z.number().int().positive().nullable(),
	reasonCode: z.string().nullable(),
});
