import type { z } from "zod";
import type {
	CrawlRunsInput,
	crawlAlertsDashboardSchema,
	crawlRunsBaseDashboardRawSchema,
} from "@/contracts/crawl-run.schema";

export interface CrawlRunStore {
	getRuns(input: CrawlRunsInput): Promise<z.output<typeof crawlRunsBaseDashboardRawSchema>>;
	getAlerts(): Promise<z.output<typeof crawlAlertsDashboardSchema>>;
}
