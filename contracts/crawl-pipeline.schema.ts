import { z } from "zod";
import { decimalIdSchema, isoTimestampSchema, nonNegativeIntegerSchema } from "./common.schema";

const acquiredCrawlRunSchema = z
	.object({
		acquired: z.literal(true),
		runId: decimalIdSchema,
		lockKey: z.string().min(1),
		runBudgetSeconds: z.number().int().positive(),
		lockTtlSeconds: z.number().int().positive(),
		heartbeatIntervalSeconds: z.number().int().positive(),
	})
	.strict();

const rejectedCrawlRunSchema = z.union([
	z.object({ acquired: z.literal(false), reason: z.literal("disabled") }).strict(),
	z
		.object({
			acquired: z.literal(false),
			reason: z.literal("source-busy"),
			activeRunId: decimalIdSchema.nullable().optional(),
		})
		.strict(),
	z
		.object({
			acquired: z.literal(false),
			reason: z.literal("cooldown"),
			nextEligibleAt: isoTimestampSchema,
		})
		.strict(),
	z
		.object({
			acquired: z.literal(false),
			reason: z.literal("capacity"),
			activeCount: nonNegativeIntegerSchema,
			retryAfterSeconds: z.number().int().positive(),
		})
		.strict(),
]);

export const crawlStartRawResponseSchema = z.union([
	acquiredCrawlRunSchema,
	rejectedCrawlRunSchema,
]);

export const crawlHeartbeatRawResponseSchema = z.discriminatedUnion("renewed", [
	z.object({ renewed: z.literal(true), staleAfter: isoTimestampSchema }).strict(),
	z
		.object({
			renewed: z.literal(false),
			reason: z.enum(["run-not-running", "lease-lost"]),
		})
		.strict(),
]);

export const crawlHistoryRowsRawResponseSchema = z
	.array(z.object({ url: z.string().url() }).strict())
	.max(1_000);

export const crawlIngestRawResponseSchema = z
	.object({
		insertedCount: nonNegativeIntegerSchema,
		skippedCount: nonNegativeIntegerSchema,
	})
	.strict();

export const crawlFinishRawResponseSchema = z
	.object({
		runId: decimalIdSchema,
		status: z.enum(["succeeded", "partial", "failed"]),
		durationMs: nonNegativeIntegerSchema,
	})
	.strict();

export const crawlContractFailureRawResponseSchema = z.boolean();

export type CrawlStartRawResponse = z.output<typeof crawlStartRawResponseSchema>;
