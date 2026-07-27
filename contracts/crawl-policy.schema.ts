import { z } from "zod";
import { decimalIdSchema, isoTimestampSchema, nonNegativeIntegerSchema } from "./common.schema";

const crawlPolicySourceSchema = z.enum(["arcalive", "battlepage", "insagirl"]);
const crawlRunStatusSchema = z.enum(["running", "succeeded", "partial", "failed", "interrupted"]);
const crawlRunTriggerSchema = z.enum(["manual", "scheduled"]);

const crawlPolicyLatestRunSchema = z.object({
	id: decimalIdSchema,
	status: crawlRunStatusSchema,
	trigger: crawlRunTriggerSchema,
	startedAt: isoTimestampSchema,
	finishedAt: isoTimestampSchema.nullable(),
	insertedCount: nonNegativeIntegerSchema,
	retryCount: nonNegativeIntegerSchema,
	recoveredCount: nonNegativeIntegerSchema,
});

const crawlSourcePolicySchema = z.object({
	source: crawlPolicySourceSchema,
	scheduleEnabled: z.boolean(),
	cooldownSeconds: z.number().int().min(1800).max(604800),
	recommendedCooldownSeconds: z.number().int().positive(),
	runBudgetSeconds: z.number().int().positive(),
	updatedAt: isoTimestampSchema,
	lastFinishedAt: isoTimestampSchema.nullable(),
	nextEligibleAt: isoTimestampSchema,
	nextScheduledAt: isoTimestampSchema.nullable(),
	activeRunId: decimalIdSchema.nullable(),
	latest: crawlPolicyLatestRunSchema.nullable(),
});

export const crawlPolicySettingsSchema = z.object({
	schedulerEnabled: z.boolean(),
	serverNow: isoTimestampSchema,
	dispatcherIntervalSeconds: z.number().int().positive(),
	sources: z.array(crawlSourcePolicySchema).length(3),
});

export const crawlPolicyUpdateInputSchema = z
	.object({
		source: crawlPolicySourceSchema,
		scheduleEnabled: z.boolean(),
		cooldownSeconds: z.number().int().min(1800).max(604800).multipleOf(60),
		expectedUpdatedAt: isoTimestampSchema,
	})
	.strict();

export const crawlPolicyUpdateResultSchema = z.object({
	updated: z.boolean(),
	reason: z.string().nullable().optional(),
	settings: crawlPolicySettingsSchema,
});

export type CrawlSourcePolicy = z.output<typeof crawlSourcePolicySchema>;
export type CrawlPolicySettings = z.output<typeof crawlPolicySettingsSchema>;
export type CrawlPolicyUpdateInput = z.input<typeof crawlPolicyUpdateInputSchema>;
