import { z } from "zod";
import { isoTimestampSchema } from "./common.schema";

const crawlTargetSchema = z.enum(["arcalive", "battlepage", "insagirl"]);
const crawlAdmissionReasonSchema = z.enum(["disabled", "cooldown", "source-busy", "capacity"]);

export const crawlCommandRequestSchema = z
	.object({
		target: crawlTargetSchema,
	})
	.strict();

export const crawlCommandSuccessSchema = z
	.object({
		runId: z.string().min(1),
		status: z.enum(["succeeded", "partial"]),
		target: crawlTargetSchema,
		insertedCount: z.number().int().nonnegative(),
		skippedCount: z.number().int().nonnegative(),
		warningCount: z.number().int().nonnegative(),
		durationMs: z.number().int().nonnegative(),
	})
	.strict();

const crawlConflictResponseSchema = z
	.object({
		error: z.string().min(1),
		activeRunId: z.string().nullable(),
	})
	.strict();

const crawlFailedResponseSchema = z
	.object({
		runId: z.string().min(1).optional(),
		status: z.literal("failed").optional(),
		target: crawlTargetSchema.optional(),
		error: z.string().min(1),
	})
	.strict();

export const internalRestErrorResponseSchema = z
	.object({
		error: z.string().min(1),
		reason: z.enum(["configuration-missing", "invalid-secret"]).optional(),
	})
	.strict();

const scheduledSkippedResponseSchema = z
	.object({
		status: z.literal("skipped"),
		target: crawlTargetSchema,
		reason: crawlAdmissionReasonSchema.exclude(["capacity"]),
		nextEligibleAt: isoTimestampSchema.nullable(),
		activeRunId: z.string().nullable(),
	})
	.strict();

const scheduledDeferredResponseSchema = z
	.object({
		status: z.literal("deferred"),
		target: crawlTargetSchema,
		reason: z.literal("capacity"),
		retryAfterSeconds: z.number().int().positive(),
	})
	.strict();

export const manualCrawlResponseSchema = z.union([
	crawlCommandSuccessSchema,
	crawlConflictResponseSchema,
	crawlFailedResponseSchema,
	internalRestErrorResponseSchema,
]);

export const scheduledCrawlResponseSchema = z.union([
	crawlCommandSuccessSchema,
	scheduledSkippedResponseSchema,
	scheduledDeferredResponseSchema,
	crawlFailedResponseSchema,
	internalRestErrorResponseSchema,
]);

export type CrawlTarget = z.infer<typeof crawlTargetSchema>;
export type CrawlAdmissionReason = z.infer<typeof crawlAdmissionReasonSchema>;
export type CrawlCommandSuccess = z.infer<typeof crawlCommandSuccessSchema>;
