import { z } from "zod";
import {
	bookmarkEditInputSchema,
	bookmarkListInputSchema,
	bookmarkLookupInputSchema,
	bookmarkProposalApplyInputSchema,
	bookmarkRecommendationInputSchema,
	bookmarkRecommendationStatusSchema,
	bookmarkSaveInputSchema,
	bookmarkScopeInputSchema,
	bookmarkVersionInputSchema,
} from "@/contracts/bookmark.schema";
import { bookmarkHealthSettingsInputSchema } from "@/contracts/bookmark-health.schema";
import { createTRPCRouter, ownerProcedure } from "../init";

const idInput = z.object({ id: z.uuid() });
const name = z.string().trim().min(1).max(160);
export const bookmarkRouter = createTRPCRouter({
	lookup: ownerProcedure
		.input(bookmarkLookupInputSchema)
		.query(({ ctx, input }) => ctx.services.bookmark.lookup(input)),
	bulk: ownerProcedure
		.input(
			z.object({
				action: z.enum(["trash", "restore", "keep"]),
				items: z.array(bookmarkVersionInputSchema).min(1).max(2000),
			})
		)
		.mutation(({ ctx, input }) => ctx.services.bookmark.bulk(input)),
	list: ownerProcedure
		.input(bookmarkListInputSchema)
		.query(({ ctx, input }) => ctx.services.bookmark.snapshot(input)),
	detail: ownerProcedure
		.input(idInput)
		.query(({ ctx, input }) => ctx.services.bookmark.snapshot(input)),
	save: ownerProcedure
		.input(bookmarkSaveInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.save(input)),
	edit: ownerProcedure
		.input(bookmarkEditInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.mutate("edit", input)),
	open: ownerProcedure
		.input(idInput)
		.mutation(({ ctx, input }) => ctx.services.bookmark.mutate("open", input)),
	keep: ownerProcedure
		.input(bookmarkVersionInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.mutate("keep", input)),
	trash: ownerProcedure
		.input(bookmarkVersionInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.mutate("trash", input)),
	restore: ownerProcedure
		.input(bookmarkVersionInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.mutate("restore", input)),
});
export const bookmarkCollectionRouter = createTRPCRouter({
	reorder: ownerProcedure
		.input(
			bookmarkVersionInputSchema.extend({
				targetId: z.uuid(),
				targetVersion: z.number().int().positive(),
				position: z.enum(["before", "after"]),
			})
		)
		.mutation(({ ctx, input }) => ctx.services.bookmark.collection("collectionReorder", input)),
	moveMany: ownerProcedure
		.input(
			z.object({
				items: z.array(bookmarkVersionInputSchema).min(1).max(2000),
				collectionId: z.uuid().nullable(),
			})
		)
		.mutation(({ ctx, input }) => ctx.services.bookmark.moveMany(input)),
	reparent: ownerProcedure
		.input(bookmarkVersionInputSchema.extend({ parentId: z.uuid().nullable() }))
		.mutation(({ ctx, input }) => ctx.services.bookmark.collection("collectionMove", input)),
	remove: ownerProcedure
		.input(bookmarkVersionInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.removeCollection(input)),
	list: ownerProcedure.query(({ ctx }) =>
		ctx.services.bookmark.snapshot({ limit: 1 }).then((s) => s.collections)
	),
	create: ownerProcedure
		.input(z.object({ name, parentId: z.uuid().nullable().optional() }))
		.mutation(({ ctx, input }) => ctx.services.bookmark.collection("collectionCreate", input)),
	rename: ownerProcedure
		.input(z.object({ id: z.uuid(), version: z.number().int().positive(), name }))
		.mutation(({ ctx, input }) => ctx.services.bookmark.collection("collectionRename", input)),
	move: ownerProcedure
		.input(bookmarkVersionInputSchema.extend({ collectionId: z.uuid().nullable() }))
		.mutation(({ ctx, input }) => ctx.services.bookmark.mutate("move", input)),
});
export const bookmarkImportRouter = createTRPCRouter({
	details: ownerProcedure
		.input(z.object({ id: z.uuid(), offset: z.number().int().nonnegative().default(0) }))
		.query(({ ctx, input }) => ctx.services.bookmark.jobDetails(input)),
	configuration: ownerProcedure.query(({ ctx }) => ctx.services.bookmark.configuration()),
	status: ownerProcedure.query(({ ctx }) => ctx.services.bookmark.jobs()),
	start: ownerProcedure
		.input(z.object({ confirmed: z.literal(true) }))
		.mutation(({ ctx, input }) =>
			ctx.services.bookmark.start("import", { scope: "all" }, input.confirmed)
		),
	resume: ownerProcedure
		.input(idInput)
		.mutation(({ ctx, input }) => ctx.services.bookmark.resume(input)),
});
export const bookmarkCheckRouter = createTRPCRouter({
	settings: ownerProcedure.query(({ ctx }) => ctx.services.bookmark.healthSettings()),
	updateSettings: ownerProcedure
		.input(bookmarkHealthSettingsInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.updateHealthSettings(input)),
	start: ownerProcedure
		.input(bookmarkScopeInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.startHealth(input)),
});
export const bookmarkAIRouter = createTRPCRouter({
	usage: ownerProcedure.query(({ ctx }) => ctx.services.bookmark.aiUsage()),
	recommend: ownerProcedure
		.input(bookmarkRecommendationInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.recommend(input)),
	recommendation: ownerProcedure
		.input(idInput)
		.output(bookmarkRecommendationStatusSchema)
		.query(({ ctx, input }) => ctx.services.bookmark.recommendation(input)),
	suggestInterests: ownerProcedure.mutation(({ ctx }) =>
		ctx.services.bookmark.start("interests", { scope: "all" })
	),
	confirmInterests: ownerProcedure
		.input(
			z.object({
				interests: z.array(z.string().trim().min(1).max(160)).max(50),
				version: z.number().int().positive().optional(),
			})
		)
		.mutation(({ ctx, input }) => ctx.services.bookmark.interests(input)),
	classify: ownerProcedure
		.input(bookmarkScopeInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.start("classify", input)),
	review: ownerProcedure
		.input(bookmarkScopeInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.start("review", input)),
});
export const bookmarkProposalRouter = createTRPCRouter({
	excludeBookmarks: ownerProcedure
		.input(z.object({ items: z.array(bookmarkVersionInputSchema).min(1).max(2000) }))
		.mutation(({ ctx, input }) => ctx.services.bookmark.excludeProposals(input)),
	approve: ownerProcedure
		.input(bookmarkProposalApplyInputSchema)
		.mutation(({ ctx, input }) => ctx.services.bookmark.apply(input)),
});
