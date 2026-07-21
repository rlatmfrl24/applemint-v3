export interface ManualCrawlResult {
	httpStatus: number;
	runId?: string;
	status?: "succeeded" | "partial";
	target: string;
	insertedCount: number;
	skippedCount: number;
	warningCount: number;
	durationMs: number;
}

export class ManualCrawlError extends Error {
	constructor(
		readonly httpStatus: number,
		readonly responseBody: unknown
	) {
		const responseError =
			typeof responseBody === "object" &&
			responseBody !== null &&
			"error" in responseBody &&
			typeof responseBody.error === "string"
				? responseBody.error
				: `크롤링 요청이 실패했습니다. (${httpStatus})`;
		super(responseError);
	}
}

function isManualCrawlResult(value: unknown): value is Omit<ManualCrawlResult, "httpStatus"> {
	if (!value || typeof value !== "object") {
		return false;
	}

	const result = value as Record<string, unknown>;
	return (
		typeof result.target === "string" &&
		typeof result.insertedCount === "number" &&
		typeof result.skippedCount === "number" &&
		typeof result.warningCount === "number" &&
		typeof result.durationMs === "number" &&
		(result.runId === undefined || typeof result.runId === "string") &&
		(result.status === undefined || result.status === "succeeded" || result.status === "partial")
	);
}

export async function requestManualCrawl(
	target: string,
	fetchImplementation: typeof fetch = fetch
): Promise<ManualCrawlResult> {
	const response = await fetchImplementation("/api/crawl/manual", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ target }),
	});
	const data = (await response.json().catch(() => null)) as unknown;

	if (!response.ok || !isManualCrawlResult(data)) {
		throw new ManualCrawlError(response.status, data);
	}

	return {
		httpStatus: response.status,
		...data,
	};
}

export async function withLoadingState<T>(
	setLoading: (loading: boolean) => void,
	operation: () => Promise<T>
) {
	setLoading(true);
	try {
		return await operation();
	} finally {
		setLoading(false);
	}
}
