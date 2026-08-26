import { crawlSourceRegistrySchema } from "@/contracts/crawl-source-registry.schema";
import { unexpectedFailure } from "@/server/errors/domain-error";
import { mapPostgrestError } from "@/server/errors/error-mapper";
import type { RequestMetrics } from "@/server/observability/request-metrics";
import type { CrawlSourceRegistryStore } from "@/server/ports/crawl-source-registry.store";
import type { AppSupabaseClient } from "@/types/supabase";

export class CrawlSourceRegistryRepository implements CrawlSourceRegistryStore {
	constructor(
		private readonly supabase: AppSupabaseClient,
		private readonly metrics?: RequestMetrics
	) {}

	async get() {
		return (
			this.metrics?.measureRepository("crawlSourceRegistry.get", () => this.fetch()) ?? this.fetch()
		);
	}

	private async fetch() {
		const { data, error } = await this.supabase.rpc("get_crawl_source_registry");
		if (error) throw mapPostgrestError(error, "수집 소스 registry를 조회하지 못했습니다.");

		const parsed = crawlSourceRegistrySchema.safeParse(data);
		if (!parsed.success) {
			throw unexpectedFailure("수집 소스 registry 응답이 올바르지 않습니다.", parsed.error);
		}
		return parsed.data;
	}
}
