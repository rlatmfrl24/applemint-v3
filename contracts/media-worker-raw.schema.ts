import { z } from "zod";
import { decimalIdSchema, isoTimestampSchema } from "./common.schema";

const claimedYouTubeJobSchema = z
	.object({
		thread_id: decimalIdSchema,
		provider: z.literal("youtube"),
		url: z.string().url(),
		attempt_count: z.number().int().positive(),
		lease_token: z.string().uuid(),
		lease_expires_at: isoTimestampSchema,
	})
	.strict();

export const claimedYouTubeJobsRawResponseSchema = z.array(claimedYouTubeJobSchema).max(50);
export type ClaimedYouTubeJob = z.output<typeof claimedYouTubeJobSchema>;
