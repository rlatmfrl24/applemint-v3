import type { CrawlCommandSuccess, CrawlTarget } from "@/contracts/crawl-command.schema";

export type ManualCrawlResult = CrawlCommandSuccess & { httpStatus: number };

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

export async function requestManualCrawl(
	target: CrawlTarget,
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

	const { crawlCommandSuccessSchema } = await import("@/contracts/crawl-command.schema");
	const parsed = crawlCommandSuccessSchema.safeParse(data);
	if (!response.ok || !parsed.success) {
		throw new ManualCrawlError(response.status, data);
	}

	return {
		httpStatus: response.status,
		...parsed.data,
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
