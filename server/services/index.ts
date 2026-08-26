import type { RequestMetrics } from "@/server/observability/request-metrics";
import { CrawlPolicyRepository } from "@/server/repositories/crawl-policy.repository";
import { CrawlRunRepository } from "@/server/repositories/crawl-run.repository";
import { CrawlSourceRegistryRepository } from "@/server/repositories/crawl-source-registry.repository";
import { PushRepository } from "@/server/repositories/push.repository";
import { ThreadRepository } from "@/server/repositories/thread.repository";
import type { AppSupabaseClient } from "@/types/supabase";
import { CrawlPolicyService } from "./crawl-policy.service";
import { CrawlRunService } from "./crawl-run.service";
import { CrawlSourceRegistryService } from "./crawl-source-registry.service";
import { PushService, type PushTestSender } from "./push.service";
import { ThreadService } from "./thread.service";

export function createServices(
	supabase: AppSupabaseClient,
	metrics?: RequestMetrics,
	options: { pushTestSender?: PushTestSender } = {}
) {
	const crawlSourceRegistry = new CrawlSourceRegistryService(
		new CrawlSourceRegistryRepository(supabase, metrics)
	);
	return {
		thread: new ThreadService(new ThreadRepository(supabase, metrics)),
		crawlPolicy: new CrawlPolicyService(
			new CrawlPolicyRepository(supabase, metrics),
			crawlSourceRegistry
		),
		crawlRun: new CrawlRunService(new CrawlRunRepository(supabase, metrics), crawlSourceRegistry),
		push: new PushService(new PushRepository(supabase, metrics), options.pushTestSender),
	};
}
