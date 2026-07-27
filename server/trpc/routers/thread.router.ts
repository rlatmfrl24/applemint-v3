import {
	threadBulkTrashOutputSchema,
	threadItemSchema,
	threadListInputSchema,
	threadPageSchema,
	threadStatsInputSchema,
	threadStatsSchema,
	threadTransitionInputSchema,
} from "@/contracts/thread.schema";
import { authenticatedReadProcedure, createTRPCRouter, ownerProcedure } from "../init";

export const threadRouter = createTRPCRouter({
	list: authenticatedReadProcedure
		.input(threadListInputSchema)
		.output(threadPageSchema)
		.query(({ ctx, input }) => ctx.services.thread.list(input)),
	stats: authenticatedReadProcedure
		.input(threadStatsInputSchema)
		.output(threadStatsSchema)
		.query(({ ctx, input }) => ctx.services.thread.stats(input)),
	transition: ownerProcedure
		.input(threadTransitionInputSchema)
		.output(threadItemSchema)
		.mutation(({ ctx, input }) => ctx.services.thread.transition(input)),
	bulkTrash: ownerProcedure
		.output(threadBulkTrashOutputSchema)
		.mutation(({ ctx }) => ctx.services.thread.bulkTrashInbox()),
});
