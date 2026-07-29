import { z } from "zod";
import {
	decimalIdSchema,
	isoTimestampSchema,
	nonNegativeIntegerSchema,
	publicDecimalIdSchema,
} from "./common.schema";

const threadStateSchema = z.enum(["inbox", "saved", "trash"]);

const threadMediaMetadataSchema = z.object({
	provider: z.literal("youtube"),
	external_id: z.string().nullable(),
	media_kind: z.enum(["video", "short", "live", "unsupported"]).nullable(),
	status: z.enum(["pending", "ready", "unavailable", "unsupported", "failed"]),
	title: z.string().nullable(),
	channel_title: z.string().nullable(),
	thumbnail_url: z.string().nullable(),
	duration_seconds: nonNegativeIntegerSchema.nullable(),
	live_status: z.enum(["none", "live", "upcoming"]).nullable(),
	last_error_code: z.string().nullable(),
	fetched_at: isoTimestampSchema.nullable(),
	updated_at: isoTimestampSchema,
});

const nullableThreadMediaMetadataSchema = z.preprocess((value) => {
	if (
		value &&
		typeof value === "object" &&
		"provider" in value &&
		(value as { provider?: unknown }).provider !== "youtube"
	) {
		return null;
	}
	return value;
}, threadMediaMetadataSchema.nullable());

export const threadItemSchema = z.object({
	id: decimalIdSchema,
	type: z.string().min(1),
	url: z.string().min(1),
	title: z.string().nullable(),
	description: z.string().nullable(),
	host: z.string().nullable(),
	tag: z.array(z.string()).nullable().optional(),
	state: threadStateSchema,
	created_at: isoTimestampSchema,
	captured_at: isoTimestampSchema,
	state_changed_at: isoTimestampSchema,
	media_metadata: nullableThreadMediaMetadataSchema.optional(),
});

export const threadPageSchema = z.object({
	items: z.array(threadItemSchema),
	nextCursor: z.string().nullable(),
});

const filterTypeSchema = z.string().trim().min(1).max(128).nullable().optional();

export const threadListInputSchema = z
	.object({
		state: threadStateSchema,
		limit: z.number().int().min(1).max(100).default(24),
		filterType: filterTypeSchema,
		cursor: z.string().max(512).nullable().optional(),
	})
	.strict();

export const threadStatsInputSchema = z
	.object({
		state: threadStateSchema,
		filterType: filterTypeSchema,
	})
	.strict();

export const threadStatsSchema = z.object({
	counts: z.array(
		z.object({
			key: z.string().min(1),
			label: z.string().min(1),
			count: nonNegativeIntegerSchema,
		})
	),
	totalCount: nonNegativeIntegerSchema,
});

export const threadTransitionInputSchema = z
	.object({
		id: publicDecimalIdSchema,
		expectedState: threadStateSchema,
		destinationState: threadStateSchema,
	})
	.strict();

export const threadBulkTrashOutputSchema = z.object({
	movedCount: nonNegativeIntegerSchema,
});

export type ThreadState = z.infer<typeof threadStateSchema>;
export type ThreadItem = z.output<typeof threadItemSchema>;
export type ThreadPage = z.output<typeof threadPageSchema>;
export type ThreadListInput = z.input<typeof threadListInputSchema>;
export type ThreadStats = z.output<typeof threadStatsSchema>;
export type ThreadTransitionInput = z.input<typeof threadTransitionInputSchema>;
