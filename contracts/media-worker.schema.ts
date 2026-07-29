import { z } from "zod";
import { internalRestErrorResponseSchema } from "./crawl-command.schema";

export function createMediaWorkerRequestSchema(maxBatchSize: number) {
	return z
		.object({
			limit: z.number().int().min(1).max(maxBatchSize).default(maxBatchSize),
		})
		.strict();
}

const boundedDiagnosticCountsSchema = z
	.record(z.string().min(1).max(128), z.number().int().nonnegative())
	.refine((value) => Object.keys(value).length <= 16, {
		message: "Diagnostic count maps can contain at most 16 keys.",
	})
	.refine((value) => JSON.stringify(value).length <= 2_048, {
		message: "Diagnostic count maps cannot exceed 2 KB.",
	});

export const mediaWorkerDiagnosticsSchema = z
	.object({
		providerOutcome: z.enum(["idle", "completed", "partial", "retrying", "rate-limited", "failed"]),
		apiRequestCount: z.number().int().nonnegative(),
		rateLimitedCount: z.number().int().nonnegative(),
		errorCounts: boundedDiagnosticCountsSchema,
		httpStatusCounts: boundedDiagnosticCountsSchema.refine(
			(value) =>
				Object.keys(value).every((key) => {
					const status = Number(key);
					return /^\d{3}$/.test(key) && status >= 100 && status <= 599;
				}),
			{ message: "HTTP diagnostic keys must be valid status codes." }
		),
		nextAvailableAt: z.string().datetime({ offset: true }).nullable(),
		cooldownUntil: z.string().datetime({ offset: true }).nullable(),
		rateLimit: z
			.object({
				clientRemaining: z.number().int().nonnegative().nullable(),
				userRemaining: z.number().int().nonnegative().nullable(),
				userResetAt: z.string().datetime({ offset: true }).nullable(),
			})
			.strict()
			.nullable(),
	})
	.strict();

export const mediaWorkerResultSchema = z
	.object({
		claimedCount: z.number().int().nonnegative(),
		readyCount: z.number().int().nonnegative(),
		unavailableCount: z.number().int().nonnegative(),
		unsupportedCount: z.number().int().nonnegative(),
		retriedCount: z.number().int().nonnegative(),
		failedCount: z.number().int().nonnegative(),
		leaseRejectedCount: z.number().int().nonnegative(),
		diagnostics: mediaWorkerDiagnosticsSchema.optional(),
	})
	.strict();

export const mediaWorkerResponseSchema = z.union([
	mediaWorkerResultSchema,
	internalRestErrorResponseSchema,
]);

export type MediaWorkerResult = z.infer<typeof mediaWorkerResultSchema>;
export type MediaWorkerDiagnostics = z.infer<typeof mediaWorkerDiagnosticsSchema>;
