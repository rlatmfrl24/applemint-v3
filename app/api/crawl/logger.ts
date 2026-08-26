import { isCrawlDebugEnabled } from "@/server/env/features";

const DEBUG_CRAWL_ENABLED = isCrawlDebugEnabled();

export const debugLog = (...args: unknown[]) => {
	if (DEBUG_CRAWL_ENABLED) {
		console.log(...args);
	}
};
