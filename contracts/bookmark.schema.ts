import { z } from "zod";

const id = z.uuid();
const json = z.record(z.string(), z.unknown());
export const bookmarkCollectionSchema = z.object({
	id,
	parent_id: id.nullable(),
	name: z.string(),
	version: z.number().int(),
	source_id: z.string().nullable(),
	original: json.nullable(),
	created_at: z.string(),
});
const bookmarkProposalSchema = z.object({
	id,
	job_id: id,
	bookmark_id: id,
	expected_version: z.number().int(),
	expected_review_revision: z.number().int(),
	expected_interest_version: z.number().int(),
	kind: z.enum(["classify", "review"]),
	target_collection_id: id.nullable(),
	new_collection_name: z.string().nullable(),
	reason: z.string(),
	relevance: z.string().nullable(),
	state: z.enum(["pending", "approved", "excluded"]),
	created_at: z.string(),
});
const checkSchema = z.object({
	id,
	bookmark_id: id,
	job_id: id,
	bookmark_version: z.number().int(),
	status: z.enum(["healthy", "dead", "restricted", "temporary", "uncheckable"]),
	reason: z.string(),
	final_url: z.string().nullable(),
	http_status: z.number().nullable(),
	checked_at: z.string(),
	reviewed_at: z.string().nullable(),
});
const eventSchema = z.object({
	id: z.number(),
	bookmark_id: id,
	kind: z.string(),
	evidence_id: id.nullable(),
	created_at: z.string(),
});
export const bookmarkSchema = z.object({
	id,
	url: z.string(),
	url_key: z.string(),
	title: z.string(),
	description: z.string(),
	tags: z.array(z.string()),
	note: z.string(),
	collection_id: id.nullable(),
	previous_collection_path: z.string().nullable().default(null),
	state: z.enum(["library", "trash"]),
	version: z.number().int(),
	source_id: z.string().nullable(),
	source_thread_id: z.string().nullable(),
	original: json.nullable(),
	saved_at: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	opened_at: z.string().nullable(),
	open_count: z.number().int(),
	review_revision: z.number().int(),
});
const bookmarkItemSchema = bookmarkSchema.extend({
	duplicate_count: z.number().int(),
	check: checkSchema.nullable(),
	proposals: z.array(bookmarkProposalSchema),
	last_review: eventSchema.nullable(),
});
export const bookmarkJobSchema = z.object({
	id,
	kind: z.enum(["metadata", "import", "check", "classify", "interests", "review"]),
	state: z.enum(["queued", "processing", "retry", "paused", "failed", "partial", "succeeded"]),
	scope: json,
	progress: json,
	total: z.number().int(),
	completed: z.number().int(),
	failed: z.number().int(),
	attempts: z.number().int(),
	available_at: z.string(),
	lease_token: id.nullable(),
	lease_expires_at: z.string().nullable(),
	error: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});
const settingsSchema = z.object({
	id: z.boolean(),
	interests: z.array(z.string()),
	interest_version: z.number().int(),
	suggested_interests: z.array(z.string()),
	suggestions_job_id: id.nullable(),
	suggested_at: z.string().nullable(),
	interests_confirmed_at: z.string().nullable(),
});
export const bookmarkSnapshotSchema = z.object({
	items: z.array(bookmarkItemSchema),
	total: z.number().int(),
	collections: z.array(bookmarkCollectionSchema),
	jobs: z.array(bookmarkJobSchema),
	settings: settingsSchema,
	budget: z.object({
		month: z.string(),
		limit_nano: z.number().int(),
		used_nano: z.number().int(),
	}),
});
export const bookmarkListInputSchema = z.object({
	state: z.enum(["library", "trash"]).default("library"),
	collectionId: id.nullable().optional(),
	search: z.string().max(200).optional(),
	offset: z.number().int().nonnegative().default(0),
	review: z.boolean().default(false),
	reviewType: z.enum(["all", "dead", "unused", "classify"]).default("all"),
	limit: z.number().int().min(1).max(100).default(50),
});
export const bookmarkSaveInputSchema = z.object({
	url: z.string().trim().min(1).max(8192),
	title: z.string().trim().max(1000).default(""),
	collectionId: id.nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
	note: z.string().max(20000).default(""),
	threadId: z
		.string()
		.regex(/^[1-9][0-9]*$/u)
		.optional(),
});
export const bookmarkVersionInputSchema = z.object({
	id,
	version: z.number().int().positive(),
	evidenceId: id.optional(),
});
export const bookmarkEditInputSchema = bookmarkVersionInputSchema.extend({
	title: z.string().trim().max(1000),
	description: z.string().max(4000),
	note: z.string().max(20000),
	tags: z.array(z.string().trim().min(1).max(100)).max(100),
	collectionId: id.nullable(),
});
export const bookmarkScopeInputSchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("all") }),
	z.object({ scope: z.literal("collection"), collectionId: id.nullable() }),
	z.object({ scope: z.literal("selected"), ids: z.array(id).min(1).max(2000) }),
]);
export const bookmarkProposalApplyInputSchema = z.object({
	items: z
		.array(
			z.object({
				id,
				exclude: z.boolean().optional(),
				collectionId: id.nullable().optional(),
				newCollectionName: z.string().trim().max(160).optional(),
			})
		)
		.min(1)
		.max(2000),
});
export type BookmarkItem = z.infer<typeof bookmarkItemSchema>;
export type BookmarkCollection = z.infer<typeof bookmarkCollectionSchema>;
export type BookmarkJob = z.infer<typeof bookmarkJobSchema>;
export type BookmarkSnapshot = z.infer<typeof bookmarkSnapshotSchema>;
export type BookmarkSaveInput = z.input<typeof bookmarkSaveInputSchema>;
export type BookmarkScope = z.infer<typeof bookmarkScopeInputSchema>;
