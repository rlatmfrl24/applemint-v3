import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { ThreadState } from "@/contracts/thread.schema";
import { prefetchInitialThreadData } from "@/server/thread-initial-prefetch";
import { getMainServerContext } from "./server-context";

export async function ThreadHydration({
	state,
	includeStats = false,
	children,
}: {
	state: ThreadState;
	includeStats?: boolean;
	children: React.ReactNode;
}) {
	const context = await getMainServerContext();
	const queryClient = new QueryClient();

	await prefetchInitialThreadData({
		queryClient,
		services: context.services,
		metrics: context.metrics,
		requestId: context.requestId,
		state,
		includeStats,
	});

	return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
