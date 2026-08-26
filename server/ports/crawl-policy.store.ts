import type { CrawlPolicySettings, CrawlPolicyUpdateInput } from "@/contracts/crawl-policy.schema";

export interface CrawlPolicyStore {
	get(): Promise<CrawlPolicySettings>;
	update(input: CrawlPolicyUpdateInput): Promise<{
		updated: boolean;
		reason?: string | null;
		settings: CrawlPolicySettings;
	}>;
}
