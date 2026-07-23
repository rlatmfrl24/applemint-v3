const LOG_LEVEL = (process.env.LOG_LEVEL ?? "").toLowerCase();
const DEBUG_CRAWL_ENABLED =
	process.env.DEBUG_CRAWL === "1" || process.env.DEBUG_CRAWL === "true" || LOG_LEVEL === "debug";

export const debugLog = (...args: unknown[]) => {
	if (DEBUG_CRAWL_ENABLED) {
		console.log(...args);
	}
};
