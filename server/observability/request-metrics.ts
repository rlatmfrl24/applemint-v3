type CallOutcome = "succeeded" | "unauthenticated" | "forbidden" | "failed";

function getResultCount(value: unknown) {
	if (Array.isArray(value)) return value.length;
	if (!value || typeof value !== "object") return 0;

	for (const key of ["items", "runs", "sources", "activeRuns", "counts"] as const) {
		const candidate = Reflect.get(value, key);
		if (Array.isArray(candidate) && candidate.length > 0) return candidate.length;
	}
	for (const key of ["insertedCount", "claimedCount", "movedCount", "totalCount"] as const) {
		const candidate = Reflect.get(value, key);
		if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
			return candidate;
		}
	}
	return 0;
}

export class RequestMetrics {
	private authCallCount = 0;
	private authDurationMs = 0;
	private ownerCallCount = 0;
	private ownerDurationMs = 0;
	private repositoryCallCount = 0;
	private repositoryDurationMs = 0;
	private readonly repositoryCalls = new Map<string, { callCount: number; durationMs: number }>();
	private downstreamCallCount = 0;
	private resultCount = 0;
	private failureCount = 0;
	private outcome: "succeeded" | "rejected" | "failed" = "succeeded";
	private errorCode: string | null = null;

	recordAuthCheck(durationMs: number, _outcome: CallOutcome) {
		this.authCallCount += 1;
		this.authDurationMs += durationMs;
		this.downstreamCallCount += 1;
	}

	recordOwnerCheck(durationMs: number, _outcome: CallOutcome) {
		this.ownerCallCount += 1;
		this.ownerDurationMs += durationMs;
		this.downstreamCallCount += 1;
	}

	async measureRepository<T>(operation: string, run: () => Promise<T>): Promise<T> {
		const startedAt = performance.now();
		const current = this.repositoryCalls.get(operation) ?? { callCount: 0, durationMs: 0 };
		if (!this.repositoryCalls.has(operation)) this.repositoryCalls.set(operation, current);
		this.repositoryCallCount += 1;
		this.downstreamCallCount += 1;
		try {
			return await run();
		} finally {
			const durationMs = performance.now() - startedAt;
			this.repositoryDurationMs += durationMs;
			current.callCount += 1;
			current.durationMs += durationMs;
		}
	}

	recordResult(value: unknown) {
		const resultCount = getResultCount(value);
		this.resultCount += resultCount;
		return resultCount;
	}

	recordFailure(errorCode: string, outcome: "rejected" | "failed") {
		this.failureCount += 1;
		this.errorCode = errorCode;
		if (outcome === "failed" || this.outcome === "succeeded") this.outcome = outcome;
	}

	snapshot() {
		return {
			authCallCount: this.authCallCount,
			authDurationMs: Math.round(this.authDurationMs),
			ownerCallCount: this.ownerCallCount,
			ownerDurationMs: Math.round(this.ownerDurationMs),
			repositoryCallCount: this.repositoryCallCount,
			repositoryDurationMs: Math.round(this.repositoryDurationMs),
			repositoryCalls: Array.from(this.repositoryCalls, ([operation, value]) => ({
				operation,
				callCount: value.callCount,
				durationMs: Math.round(value.durationMs),
			})),
			downstreamCallCount: this.downstreamCallCount,
			resultCount: this.resultCount,
			failureCount: this.failureCount,
			outcome: this.outcome,
			errorCode: this.errorCode,
		};
	}
}
