import type { z } from "zod";
import type {
	CrawlRunsInput,
	crawlAlertsDashboardSchema,
	crawlRunsBaseDashboardSchema,
} from "@/contracts/crawl-run.schema";

export interface CrawlRunStore {
	getRuns(input: CrawlRunsInput): Promise<z.output<typeof crawlRunsBaseDashboardSchema>>;
	getAlerts(): Promise<z.output<typeof crawlAlertsDashboardSchema>>;
}
