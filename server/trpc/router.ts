import { createCallerFactory, createTRPCRouter } from "./init";
import { crawlPolicyRouter } from "./routers/crawl-policy.router";
import { crawlRunRouter } from "./routers/crawl-run.router";
import { pushRouter } from "./routers/push.router";
import { threadRouter } from "./routers/thread.router";

export const appRouter = createTRPCRouter({
	thread: threadRouter,
	crawl: crawlRunRouter,
	crawlPolicy: crawlPolicyRouter,
	push: pushRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
