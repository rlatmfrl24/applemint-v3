import { z } from "zod";

export const bookmarkAIUsageSchema = z.object({
	month: z.string(),
	limitNano: z.number().int().nonnegative(),
	usedNano: z.number().int().nonnegative(),
	chargedNano: z.number().int().nonnegative(),
	heldNano: z.number().int().nonnegative(),
	requestCount: z.number().int().nonnegative(),
	models: z.array(
		z.object({
			provider: z.string().nullable(),
			model: z.string().nullable(),
			requests: z.number().int().nonnegative(),
			settledRequests: z.number().int().nonnegative(),
			heldRequests: z.number().int().nonnegative(),
			chargedNano: z.number().int().nonnegative(),
			heldNano: z.number().int().nonnegative(),
		})
	),
});
export type BookmarkAIUsage = z.infer<typeof bookmarkAIUsageSchema>;
