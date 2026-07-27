import type { QueryClient } from "@tanstack/react-query";
import type { ThreadState } from "@/contracts/thread.schema";
import { threadListQueryKey, threadStatsQueryKey } from "@/lib/thread-list-contract";
import { DomainError } from "@/server/errors/domain-error";
import type { RequestMetrics } from "@/server/observability/request-metrics";
import type { createServices } from "@/server/services";

type ThreadServices = {
	thread: Pick<ReturnType<typeof createServices>["thread"], "list" | "stats">;
};

interface InitialThreadPrefetchInput {
	queryClient: QueryClient;
	services: ThreadServices;
	metrics: RequestMetrics;
	requestId: string;
	state: ThreadState;
	includeStats?: boolean;
}

function errorCode(error: unknown) {
	return error instanceof DomainError ? error.code : "UnexpectedFailure";
}

export async function prefetchInitialThreadData({
	queryClient,
	services,
	metrics,
	requestId,
	state,
	includeStats = false,
}: InitialThreadPrefetchInput) {
	const startedAt = performance.now();
	const listKey = threadListQueryKey(state);
	const statsKey = threadStatsQueryKey(state);

	const listTask = services.thread
		.list({
			state,
			limit: 24,
			filterType: null,
			cursor: null,
		})
		.then((page) => {
			queryClient.setQueryData(listKey, {
				pages: [page],
				pageParams: [undefined],
			});
			metrics.recordResult(page);
			return page;
		});

	const statsTask = includeStats
		? services.thread.stats({ state, filterType: null }).then((stats) => {
				queryClient.setQueryData(statsKey, stats);
				metrics.recordResult(stats);
				return stats;
			})
		: null;

	const [listResult, statsResult] = await Promise.all([
		Promise.allSettled([listTask]).then(([result]) => result),
		statsTask ? Promise.allSettled([statsTask]).then(([result]) => result) : Promise.resolve(null),
	]);

	if (listResult.status === "rejected") {
		metrics.recordFailure(errorCode(listResult.reason), "failed");
	}
	if (statsResult?.status === "rejected") {
		metrics.recordFailure(errorCode(statsResult.reason), "failed");
	}

	const outcome =
		listResult.status === "rejected"
			? "failed"
			: statsResult?.status === "rejected"
				? "partial"
				: "succeeded";
	const snapshot = metrics.snapshot();
	const log = {
		requestId,
		transport: "rsc",
		operation: "thread.initial",
		event: "request",
		state,
		requestDurationMs: Math.round(performance.now() - startedAt),
		...snapshot,
		outcome,
	};

	if (outcome === "succeeded") {
		console.info(log);
	} else {
		console.error(log);
	}

	return {
		listStatus: listResult.status,
		statsStatus: statsResult?.status ?? "skipped",
	};
}
