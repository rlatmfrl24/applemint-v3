import type { CrawlSourceRegistry } from "@/contracts/crawl-source-registry.schema";

export interface CrawlSourceRegistryStore {
	get(): Promise<CrawlSourceRegistry>;
}
