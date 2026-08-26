import type { RequestMetrics } from "@/server/observability/request-metrics";
import { CrawlPolicyRepository } from "@/server/repositories/crawl-policy.repository";
import { CrawlRunRepository } from "@/server/repositories/crawl-run.repository";
import { PushRepository } from "@/server/repositories/push.repository";
import { ThreadRepository } from "@/server/repositories/thread.repository";
import type { AppSupabaseClient } from "@/types/supabase";
import { CrawlPolicyService } from "./crawl-policy.service";
import { CrawlRunService } from "./crawl-run.service";
import { PushService, type PushTestSender } from "./push.service";
import { ThreadService } from "./thread.service";

export function createServices(
	supabase: AppSupabaseClient,
	metrics?: RequestMetrics,
	options: { pushTestSender?: PushTestSender } = {}
) {
	return {
		thread: new ThreadService(new ThreadRepository(supabase, metrics)),
		crawlPolicy: new CrawlPolicyService(new CrawlPolicyRepository(supabase, metrics)),
		crawlRun: new CrawlRunService(new CrawlRunRepository(supabase, metrics)),
		push: new PushService(new PushRepository(supabase, metrics), options.pushTestSender),
	};
}
