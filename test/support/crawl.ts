export function createCrawlPipelineResult(overrides: Record<string, unknown> = {}) {
	return {
		runId: "42",
		status: "succeeded",
		target: "arcalive",
		insertedCount: 3,
		skippedCount: 1,
		warningCount: 0,
		durationMs: 100,
		...overrides,
	};
}

export function createMediaWorkerResult(overrides: Record<string, unknown> = {}) {
	return {
		claimedCount: 0,
		readyCount: 0,
		unavailableCount: 0,
		unsupportedCount: 0,
		retriedCount: 0,
		failedCount: 0,
		leaseRejectedCount: 0,
		...overrides,
	};
}
