import { type CrawlRunsDashboard, isCrawlRunsDashboard } from "@/lib/crawl-run-contract";

export async function fetchCrawlRunsDashboard(
	fetchImplementation: typeof fetch = fetch
): Promise<CrawlRunsDashboard> {
	const response = await fetchImplementation("/api/crawl/runs?limit=20&trendLimit=20", {
		method: "GET",
		cache: "no-store",
	});
	const data = (await response.json().catch(() => null)) as unknown;
	if (!response.ok) {
		const message =
			data && typeof data === "object" && "error" in data && typeof data.error === "string"
				? data.error
				: `크롤링 실행 이력을 조회하지 못했습니다. (${response.status})`;
		throw new Error(message);
	}
	if (!isCrawlRunsDashboard(data)) {
		throw new Error("크롤링 실행 이력 응답이 올바르지 않습니다.");
	}
	return data;
}
