import { z } from "zod";
import { isoTimestampSchema } from "./common.schema";

const crawlSourceRegistryEntrySchema = z
	.object({
		source: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
		label: z.string().trim().min(1).max(80),
		active: z.boolean(),
		retiredAt: isoTimestampSchema.nullable(),
		updatedAt: isoTimestampSchema,
	})
	.superRefine((entry, context) => {
		if (entry.active === (entry.retiredAt !== null)) {
			context.addIssue({
				code: "custom",
				message: "Active sources cannot be retired and inactive sources require retiredAt.",
			});
		}
	});

export const crawlSourceRegistrySchema = z
	.object({
		sources: z.array(crawlSourceRegistryEntrySchema),
	})
	.superRefine((registry, context) => {
		const seen = new Set<string>();
		for (const entry of registry.sources) {
			if (seen.has(entry.source)) {
				context.addIssue({
					code: "custom",
					path: ["sources"],
					message: `Duplicate crawl source registry entry: ${entry.source}`,
				});
			}
			seen.add(entry.source);
		}
	});

export type CrawlSourceRegistry = z.output<typeof crawlSourceRegistrySchema>;
