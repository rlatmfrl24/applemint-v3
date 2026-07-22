import {
	type CrawlPolicySettings,
	type CrawlPolicySource,
	isCrawlPolicySettings,
} from "@/lib/crawl-policy-contract";

export class CrawlPolicyUpdateError extends Error {
	constructor(
		readonly httpStatus: number,
		message: string,
		readonly latestSettings: CrawlPolicySettings | null = null
	) {
		super(message);
	}
}

async function readJson(response: Response) {
	return (await response.json().catch(() => null)) as unknown;
}

function getErrorMessage(value: unknown, fallback: string) {
	return value && typeof value === "object" && "error" in value && typeof value.error === "string"
		? value.error
		: fallback;
}

export async function fetchCrawlPolicySettings(
	fetchImplementation: typeof fetch = fetch
): Promise<CrawlPolicySettings> {
	const response = await fetchImplementation("/api/crawl/policies", {
		method: "GET",
		cache: "no-store",
	});
	const data = await readJson(response);
	if (!response.ok) {
		throw new Error(getErrorMessage(data, `수집 정책을 조회하지 못했습니다. (${response.status})`));
	}
	if (!isCrawlPolicySettings(data)) {
		throw new Error("수집 정책 응답이 올바르지 않습니다.");
	}
	return data;
}

export async function updateCrawlPolicy(
	source: CrawlPolicySource,
	input: { scheduleEnabled: boolean; cooldownSeconds: number; expectedUpdatedAt: string },
	fetchImplementation: typeof fetch = fetch
): Promise<CrawlPolicySettings> {
	const response = await fetchImplementation(`/api/crawl/policies/${source}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await readJson(response);
	if (!response.ok) {
		const latestSettings =
			data && typeof data === "object" && "settings" in data && isCrawlPolicySettings(data.settings)
				? data.settings
				: null;
		throw new CrawlPolicyUpdateError(
			response.status,
			getErrorMessage(data, `수집 정책을 저장하지 못했습니다. (${response.status})`),
			latestSettings
		);
	}
	if (!isCrawlPolicySettings(data)) {
		throw new CrawlPolicyUpdateError(response.status, "수집 정책 수정 응답이 올바르지 않습니다.");
	}
	return data;
}
