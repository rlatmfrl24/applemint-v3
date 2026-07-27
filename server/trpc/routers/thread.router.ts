import {
	threadBulkTrashOutputSchema,
	threadItemSchema,
	threadListInputSchema,
	threadPageSchema,
	threadStatsInputSchema,
	threadStatsSchema,
	threadTransitionInputSchema,
} from "@/contracts/thread.schema";
import { createTRPCRouter, ownerProcedure } from "../init";

export const threadRouter = createTRPCRouter({
	list: ownerProcedure
		.input(threadListInputSchema)
		.output(threadPageSchema)
		.query(({ ctx, input }) => ctx.services.thread.list(input)),
	stats: ownerProcedure
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
