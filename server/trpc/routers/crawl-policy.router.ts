import {
	crawlPolicySettingsSchema,
	crawlPolicyUpdateInputSchema,
} from "@/contracts/crawl-policy.schema";
import { createTRPCRouter, ownerProcedure } from "../init";

export const crawlPolicyRouter = createTRPCRouter({
	get: ownerProcedure
		.output(crawlPolicySettingsSchema)
		.query(({ ctx }) => ctx.services.crawlPolicy.get()),
	update: ownerProcedure
		.input(crawlPolicyUpdateInputSchema)
		.output(crawlPolicySettingsSchema)
		.mutation(({ ctx, input }) => ctx.services.crawlPolicy.update(input)),
});
