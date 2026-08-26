import {
	type CrawlPolicyUpdateInput,
	crawlPolicySettingsSchema,
	crawlPolicyUpdateResultSchema,
} from "@/contracts/crawl-policy.schema";
import { unexpectedFailure } from "@/server/errors/domain-error";
import { mapPostgrestError } from "@/server/errors/error-mapper";
import type { RequestMetrics } from "@/server/observability/request-metrics";
import type { CrawlPolicyStore } from "@/server/ports/crawl-policy.store";
import type { AppSupabaseClient } from "@/types/supabase";

export class CrawlPolicyRepository implements CrawlPolicyStore {
	constructor(
		private readonly supabase: AppSupabaseClient,
		private readonly metrics?: RequestMetrics
	) {}

	private measure<T>(operation: string, run: () => Promise<T>) {
		return this.metrics?.measureRepository(operation, run) ?? run();
	}

	async get() {
		return this.measure("crawlPolicy.get", async () => {
			const { data, error } = await this.supabase.rpc("get_crawl_source_policy_settings");
			if (error) throw mapPostgrestError(error, "수집 정책을 조회하지 못했습니다.");

			const parsed = crawlPolicySettingsSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("수집 정책 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async update(input: CrawlPolicyUpdateInput) {
		return this.measure("crawlPolicy.update", async () => {
			const { data, error } = await this.supabase.rpc("update_crawl_source_policy", {
				p_source: input.source,
				p_schedule_enabled: input.scheduleEnabled,
				p_cooldown_seconds: input.cooldownSeconds,
				p_expected_updated_at: input.expectedUpdatedAt,
			});
			if (error) throw mapPostgrestError(error, "수집 정책을 저장하지 못했습니다.");

			const parsed = crawlPolicyUpdateResultSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("수집 정책 수정 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}
}
