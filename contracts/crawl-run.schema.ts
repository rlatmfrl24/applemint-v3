import { z } from "zod";
import { decimalIdSchema, isoTimestampSchema, nonNegativeIntegerSchema } from "./common.schema";
import { type CrawlSource, crawlSourceSchema } from "./crawl-source.schema";

const crawlRunStatusSchema = z.enum(["running", "succeeded", "partial", "failed", "interrupted"]);
const finishedCrawlRunStatusSchema = z.enum(["succeeded", "partial", "failed", "interrupted"]);
const crawlRunTriggerSchema = z.enum(["manual", "scheduled"]);
const crawlAlertSignalSchema = z.enum([
	"parser-failure",
	"parser-volume-drop",
	"no-recent-success",
	"transport-error-rate",
]);

const crawlRunDetailItemSchema = z.object({
	url: z.string().optional(),
	message: z.string().optional(),
	kind: z.enum(["network", "parser", "upstream-challenge"]).optional(),
	timeout: z.boolean().optional(),
	code: z.string().optional(),
	severity: z.enum(["info", "warning"]).optional(),
	count: nonNegativeIntegerSchema.optional(),
	attempt: z.number().int().positive().optional(),
});

const crawlParserObservationSchema = z.object({
	url: z.string(),
	status: z.enum(["ok", "empty", "failure"]),
	candidateCount: nonNegativeIntegerSchema,
	validCount: nonNegativeIntegerSchema,
	discardedCount: nonNegativeIntegerSchema,
	ignoredCount: nonNegativeIntegerSchema.optional(),
	duplicateCount: nonNegativeIntegerSchema.optional(),
	minimumItems: nonNegativeIntegerSchema,
	attempt: z.number().int().positive().optional(),
});

const crawlRunSchema = z.object({
	id: decimalIdSchema,
	source: crawlSourceSchema,
	status: crawlRunStatusSchema,
	trigger: crawlRunTriggerSchema,
	startedAt: isoTimestampSchema,
	finishedAt: isoTimestampSchema.nullable(),
	lastHeartbeatAt: isoTimestampSchema.nullable(),
	durationMs: nonNegativeIntegerSchema.nullable(),
	retryCount: nonNegativeIntegerSchema,
	recoveredCount: nonNegativeIntegerSchema,
	attemptedCount: nonNegativeIntegerSchema,
	succeededCount: nonNegativeIntegerSchema,
	extractedCount: nonNegativeIntegerSchema,
	insertedCount: nonNegativeIntegerSchema,
	skippedCount: nonNegativeIntegerSchema,
	warningCount: nonNegativeIntegerSchema,
	failureCount: nonNegativeIntegerSchema,
	networkFailureCount: nonNegativeIntegerSchema,
	parserFailureCount: nonNegativeIntegerSchema,
	timeoutFailureCount: nonNegativeIntegerSchema,
	parserValidCount: nonNegativeIntegerSchema,
	parserMinimumCount: nonNegativeIntegerSchema,
	warnings: z.array(crawlRunDetailItemSchema),
	failures: z.array(crawlRunDetailItemSchema),
	parserObservations: z.array(crawlParserObservationSchema),
	errorStage: z.string().nullable(),
	errorMessage: z.string().nullable(),
});

const activeCrawlRunSchema = z.object({
	id: decimalIdSchema,
	source: crawlSourceSchema,
	status: z.literal("running"),
	startedAt: isoTimestampSchema,
	staleAfter: isoTimestampSchema,
	lastHeartbeatAt: isoTimestampSchema.nullable(),
});

const crawlRunTrendPointSchema = z.object({
	id: decimalIdSchema,
	status: finishedCrawlRunStatusSchema,
	startedAt: isoTimestampSchema,
	extractedCount: nonNegativeIntegerSchema,
	parserValidCount: nonNegativeIntegerSchema,
	parserMinimumCount: nonNegativeIntegerSchema,
	failureCount: nonNegativeIntegerSchema,
});

const crawlSourceSummaryBaseSchema = z.object({
	source: crawlSourceSchema,
	scheduleEnabled: z.boolean(),
	cooldownSeconds: z.number().int().positive(),
	runBudgetSeconds: z.number().int().positive(),
	lastFinishedAt: isoTimestampSchema.nullable(),
	nextEligibleAt: isoTimestampSchema.nullable(),
	lastSuccessAt: isoTimestampSchema.nullable(),
	lastFailureAt: isoTimestampSchema.nullable(),
	latest: z
		.object({
			id: decimalIdSchema,
			status: crawlRunStatusSchema,
			trigger: crawlRunTriggerSchema,
			startedAt: isoTimestampSchema,
			durationMs: nonNegativeIntegerSchema.nullable(),
			extractedCount: nonNegativeIntegerSchema,
			insertedCount: nonNegativeIntegerSchema,
			retryCount: nonNegativeIntegerSchema,
			recoveredCount: nonNegativeIntegerSchema,
		})
		.nullable(),
	trend: z.array(crawlRunTrendPointSchema),
});

const crawlSourceSummarySchema = crawlSourceSummaryBaseSchema.extend({
	activeAlertCount: nonNegativeIntegerSchema,
});

const crawlAlertSnapshotSchema = z.object({
	latestRunId: decimalIdSchema.nullable(),
	parserFailureTriggered: z.boolean(),
	parserValidRatio: z.number().finite().nullable(),
	lastSuccessAt: isoTimestampSchema.nullable(),
	hoursSinceSuccess: z.number().finite().nonnegative().nullable(),
	transportWindow: nonNegativeIntegerSchema,
	transportAttemptedCount: nonNegativeIntegerSchema,
	transportFailureCount: nonNegativeIntegerSchema,
	transportFailureRatio: z.number().finite().nonnegative(),
});

const crawlAlertIncidentSchema = z.object({
	id: decimalIdSchema,
	source: crawlSourceSchema,
	activeSignals: z.array(crawlAlertSignalSchema),
	openedAt: isoTimestampSchema,
	lastObservedAt: isoTimestampSchema,
	snapshot: crawlAlertSnapshotSchema,
});

const crawlAlertSettingsSchema = z.object({
	parserFailureStreak: z.number().int().positive(),
	parserDropRatio: z.number().finite().nonnegative(),
	parserDropStreak: z.number().int().positive(),
	noSuccessSeconds: z.number().int().positive(),
	transportWindow: z.number().int().positive(),
	transportErrorRatio: z.number().finite().nonnegative(),
	transportMinFailures: z.number().int().positive(),
	lastEvaluatedAt: isoTimestampSchema.nullable(),
});

export const crawlRunsBaseDashboardSchema = z.object({
	activeRun: activeCrawlRunSchema.nullable(),
	activeRuns: z.array(activeCrawlRunSchema),
	runtimeSettings: z.object({
		maxConcurrency: z.number().int().positive(),
		lockTtlSeconds: z.number().int().positive(),
		heartbeatIntervalSeconds: z.number().int().positive(),
	}),
	sources: z.array(crawlSourceSummaryBaseSchema),
	runs: z.array(crawlRunSchema),
});

export const crawlAlertsDashboardSchema = z.object({
	alerts: z.array(crawlAlertIncidentSchema),
	alertSettings: crawlAlertSettingsSchema,
});

export const crawlRunsDashboardSchema = crawlRunsBaseDashboardSchema.extend({
	sources: z.array(crawlSourceSummarySchema),
	alerts: z.array(crawlAlertIncidentSchema),
	alertSettings: crawlAlertSettingsSchema,
});

export const crawlRunsInputSchema = z
	.object({
		limit: z.number().int().min(1).max(50).default(20),
		trendLimit: z.number().int().min(1).max(50).default(20),
	})
	.strict();

export type { CrawlSource };
export type CrawlRunStatus = z.infer<typeof crawlRunStatusSchema>;
export type CrawlAlertSignal = z.infer<typeof crawlAlertSignalSchema>;
export type CrawlRun = z.output<typeof crawlRunSchema>;
export type CrawlSourceSummary = z.output<typeof crawlSourceSummarySchema>;
export type CrawlAlertIncident = z.output<typeof crawlAlertIncidentSchema>;
export type CrawlAlertSettings = z.output<typeof crawlAlertSettingsSchema>;
export type CrawlRunsDashboard = z.output<typeof crawlRunsDashboardSchema>;
export type CrawlRunsInput = z.input<typeof crawlRunsInputSchema>;
