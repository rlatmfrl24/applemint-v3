import { z } from "zod";
import { internalRestErrorResponseSchema } from "./crawl-command.schema";

export function createMediaWorkerRequestSchema(maxBatchSize: number) {
	return z
		.object({
			limit: z.number().int().min(1).max(maxBatchSize).default(maxBatchSize),
		})
		.strict();
}

export const mediaWorkerResultSchema = z
	.object({
		claimedCount: z.number().int().nonnegative(),
		readyCount: z.number().int().nonnegative(),
		unavailableCount: z.number().int().nonnegative(),
		unsupportedCount: z.number().int().nonnegative(),
		retriedCount: z.number().int().nonnegative(),
		failedCount: z.number().int().nonnegative(),
		leaseRejectedCount: z.number().int().nonnegative(),
	})
	.strict();

export const mediaWorkerResponseSchema = z.union([
	mediaWorkerResultSchema,
	internalRestErrorResponseSchema,
]);

export type MediaWorkerResult = z.infer<typeof mediaWorkerResultSchema>;
