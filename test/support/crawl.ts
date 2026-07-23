export function createCrawlPipelineResult(overrides: Record<string, unknown> = {}) {
	return {
		runId: "42",
		status: "succeeded",
		target: "arcalive",
		insertedCount: 3,
		...overrides,
	};
}
