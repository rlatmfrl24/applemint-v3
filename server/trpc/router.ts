import { createCallerFactory, createTRPCRouter } from "./init";
import { crawlPolicyRouter } from "./routers/crawl-policy.router";
import { crawlRunRouter } from "./routers/crawl-run.router";
import { threadRouter } from "./routers/thread.router";

export const appRouter = createTRPCRouter({
	thread: threadRouter,
	crawl: crawlRunRouter,
	crawlPolicy: crawlPolicyRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
