import type {
	CrawlPolicySettingsRaw,
	CrawlPolicyUpdateInput,
} from "@/contracts/crawl-policy.schema";

export interface CrawlPolicyStore {
	get(): Promise<CrawlPolicySettingsRaw>;
	update(input: CrawlPolicyUpdateInput): Promise<{
		updated: boolean;
		reason?: string | null;
		settings: CrawlPolicySettingsRaw;
	}>;
}
