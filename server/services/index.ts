import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestMetrics } from "@/server/observability/request-metrics";
import { CrawlPolicyRepository } from "@/server/repositories/crawl-policy.repository";
import { CrawlRunRepository } from "@/server/repositories/crawl-run.repository";
import { ThreadRepository } from "@/server/repositories/thread.repository";
import { CrawlPolicyService } from "./crawl-policy.service";
import { CrawlRunService } from "./crawl-run.service";
import { ThreadService } from "./thread.service";

export function createServices(supabase: SupabaseClient, metrics?: RequestMetrics) {
	return {
		thread: new ThreadService(new ThreadRepository(supabase, metrics)),
		crawlPolicy: new CrawlPolicyService(new CrawlPolicyRepository(supabase, metrics)),
		crawlRun: new CrawlRunService(new CrawlRunRepository(supabase, metrics)),
	};
}
