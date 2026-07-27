import { crawlRunsDashboardSchema, crawlRunsInputSchema } from "@/contracts/crawl-run.schema";
import { createTRPCRouter, ownerProcedure } from "../init";

export const crawlRunRouter = createTRPCRouter({
	runs: ownerProcedure
		.input(crawlRunsInputSchema)
		.output(crawlRunsDashboardSchema)
		.query(({ ctx, input }) => ctx.services.crawlRun.getDashboard(input)),
});
