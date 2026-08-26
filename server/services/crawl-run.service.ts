import type { CrawlRunsDashboard, CrawlRunsInput } from "@/contracts/crawl-run.schema";
import type { CrawlRunStore } from "@/server/ports/crawl-run.store";
import {
	attachInstalledCrawlSourceLabels,
	type CrawlSourceRegistryService,
} from "./crawl-source-registry.service";

export class CrawlRunService {
	constructor(
		private readonly store: CrawlRunStore,
		private readonly registry: CrawlSourceRegistryService
	) {}

	async getDashboard(input: CrawlRunsInput) {
		const [runs, alerts, installedSources] = await Promise.all([
			this.store.getRuns(input),
			this.store.getAlerts(),
			this.registry.getInstalledSources(),
		]);
		const alertCounts = new Map<string, number>();
		for (const alert of alerts.alerts) {
			alertCounts.set(alert.source, (alertCounts.get(alert.source) ?? 0) + 1);
		}

		const sourceSummaries = attachInstalledCrawlSourceLabels(
			runs.sources,
			installedSources,
			"수집 실행 dashboard"
		);
		return {
			...runs,
			sources: sourceSummaries.map((source) => ({
				...source,
				activeAlertCount: alertCounts.get(source.source) ?? 0,
			})),
			alerts: alerts.alerts,
			alertSettings: alerts.alertSettings,
		} satisfies CrawlRunsDashboard;
	}
}
