import { z } from "zod";
import { bookmarkJobSchema } from "./bookmark.schema";

export const bookmarkScheduledSettingsInputSchema = z.object({
	enabled: z.boolean(),
	dailyLimit: z.number().int().min(1).max(500),
});

export const bookmarkScheduledSettingsSchema = bookmarkScheduledSettingsInputSchema.extend({
	timeZone: z.literal("Asia/Seoul"),
	hour: z.literal(9),
	startedAt: z.iso.datetime({ offset: true }).nullable(),
	nextEligibleAt: z.iso.datetime({ offset: true }).nullable(),
	status: z.enum(["disabled", "waiting", "running", "blocked", "complete"]),
	lastJob: bookmarkJobSchema.nullable(),
});

export const bookmarkScheduledCloseInputSchema = z.object({
	id: z.uuid(),
	confirmed: z.literal(true),
});

export type BookmarkScheduledSettings = z.infer<typeof bookmarkScheduledSettingsSchema>;
export type BookmarkScheduledSettingsInput = z.infer<typeof bookmarkScheduledSettingsInputSchema>;
export type BookmarkScheduledCloseInput = z.infer<typeof bookmarkScheduledCloseInputSchema>;
