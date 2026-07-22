export type CrawlExecutionMode = "edge" | "next";

export function resolveCrawlExecutionMode(
	configuredMode = process.env.CRAWL_EXECUTION_MODE
): CrawlExecutionMode | null {
	const normalizedMode = configuredMode?.trim().toLowerCase();
	if (!normalizedMode) return "next";
	if (normalizedMode === "edge" || normalizedMode === "next") return normalizedMode;
	return null;
}
