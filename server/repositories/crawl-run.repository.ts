import type { SupabaseClient } from "@supabase/supabase-js";
import {
	type CrawlRunsInput,
	crawlAlertsDashboardSchema,
	crawlRunsBaseDashboardSchema,
} from "@/contracts/crawl-run.schema";
import { unexpectedFailure } from "@/server/errors/domain-error";
import { mapPostgrestError } from "@/server/errors/error-mapper";
import type { RequestMetrics } from "@/server/observability/request-metrics";

export class CrawlRunRepository {
	constructor(
		private readonly supabase: SupabaseClient,
		private readonly metrics?: RequestMetrics
	) {}

	private measure<T>(operation: string, run: () => Promise<T>) {
		return this.metrics?.measureRepository(operation, run) ?? run();
	}

	async getRuns(input: CrawlRunsInput) {
		return this.measure("crawl.runs", async () => {
			const { data, error } = await this.supabase.rpc("get_crawl_runs_dashboard", {
				p_limit: input.limit ?? 20,
				p_trend_limit: input.trendLimit ?? 20,
			});
			if (error) throw mapPostgrestError(error, "크롤링 실행 이력을 조회하지 못했습니다.");

			const parsed = crawlRunsBaseDashboardSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("크롤링 실행 이력 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async getAlerts() {
		return this.measure("crawl.alerts", async () => {
			const { data, error } = await this.supabase.rpc("get_crawl_alerts_dashboard");
			if (error) throw mapPostgrestError(error, "크롤링 장애 알림을 조회하지 못했습니다.");

			const parsed = crawlAlertsDashboardSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("크롤링 장애 알림 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}
}
