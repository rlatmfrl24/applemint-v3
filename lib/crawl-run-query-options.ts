import { queryOptions } from "@tanstack/react-query";
import type { TRPCClient } from "@trpc/client";
import type { AppRouter } from "@/server/trpc/router";

const CRAWL_RUNS_INPUT = { limit: 20, trendLimit: 20 } as const;
export const CRAWL_RUNS_QUERY_KEY = ["crawl-runs", "dashboard"] as const;

export function createCrawlRunsQueryOptions(
	trpc: TRPCClient<AppRouter>,
	manualCrawlRunning: boolean
) {
	return queryOptions({
		queryKey: CRAWL_RUNS_QUERY_KEY,
		queryFn: ({ signal }) => trpc.crawl.runs.query(CRAWL_RUNS_INPUT, { signal }),
		refetchInterval: (currentQuery) =>
			manualCrawlRunning || (currentQuery.state.data?.activeRuns.length ?? 0) > 0 ? 5000 : false,
		refetchOnWindowFocus: true,
	});
}
