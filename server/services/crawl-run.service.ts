import type { CrawlRunsDashboard, CrawlRunsInput } from "@/contracts/crawl-run.schema";
import type { CrawlRunStore } from "@/server/ports/crawl-run.store";

export class CrawlRunService {
	constructor(private readonly store: CrawlRunStore) {}

	async getDashboard(input: CrawlRunsInput) {
		const [runs, alerts] = await Promise.all([this.store.getRuns(input), this.store.getAlerts()]);
		const alertCounts = new Map<string, number>();
		for (const alert of alerts.alerts) {
			alertCounts.set(alert.source, (alertCounts.get(alert.source) ?? 0) + 1);
		}

		return {
			...runs,
			sources: runs.sources.map((source) => ({
				...source,
				activeAlertCount: alertCounts.get(source.source) ?? 0,
			})),
			alerts: alerts.alerts,
			alertSettings: alerts.alertSettings,
		} satisfies CrawlRunsDashboard;
	}
}
