import { createClient } from "@supabase/supabase-js";
import { getE2ERuntime } from "./runtime";

export type E2EThreadState = "inbox" | "saved" | "trash";

interface SeedThreadOptions {
	prefix?: string;
}

interface SeedCrawlRunOptions {
	source: "arcalive" | "battlepage" | "insagirl";
	status: "running" | "succeeded";
	startedAt: string;
}

function createAdminClient() {
	const runtime = getE2ERuntime();
	return createClient(runtime.supabaseUrl, runtime.secretKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});
}

export async function clearThreadTables() {
	const supabase = createAdminClient();
	const { error } = await supabase.from("threads").delete().gte("id", 0);
	if (error) throw new Error(`threads E2E 데이터 초기화 실패: ${error.message}`);
}

export async function clearCrawlRuns() {
	const supabase = createAdminClient();
	const dispatchResult = await supabase
		.from("crawl_schedule_dispatches")
		.delete()
		.not("id", "is", null);
	if (dispatchResult.error) {
		throw new Error(`crawl E2E 데이터 초기화 실패: ${dispatchResult.error.message}`);
	}
	const lockResult = await supabase.from("crawl_run_locks").delete().not("lock_key", "is", null);
	if (lockResult.error) {
		throw new Error(`crawl E2E 데이터 초기화 실패: ${lockResult.error.message}`);
	}
	const runResult = await supabase.from("crawl_runs").delete().gte("id", 0);
	if (runResult.error) {
		throw new Error(`crawl E2E 데이터 초기화 실패: ${runResult.error.message}`);
	}
}

export async function resetCrawlPolicies() {
	const supabase = createAdminClient();
	const policies = [
		{ source: "arcalive", cooldown_seconds: 7200, recommended_cooldown_seconds: 7200 },
		{ source: "battlepage", cooldown_seconds: 14400, recommended_cooldown_seconds: 14400 },
		{ source: "insagirl", cooldown_seconds: 10800, recommended_cooldown_seconds: 10800 },
	];
	for (const policy of policies) {
		const { error } = await supabase
			.from("crawl_source_policies")
			.update({
				schedule_enabled: true,
				cooldown_seconds: policy.cooldown_seconds,
				recommended_cooldown_seconds: policy.recommended_cooldown_seconds,
				updated_at: new Date().toISOString(),
			})
			.eq("source", policy.source);
		if (error) throw new Error(`crawl_source_policies E2E 초기화 실패: ${error.message}`);
	}
	const { error } = await supabase
		.from("crawl_runtime_settings")
		.update({ scheduler_enabled: false })
		.eq("id", true);
	if (error) throw new Error(`crawl_runtime_settings E2E 초기화 실패: ${error.message}`);
}

export async function setCrawlSchedulerEnabled(enabled: boolean) {
	const supabase = createAdminClient();
	const { error } = await supabase
		.from("crawl_runtime_settings")
		.update({ scheduler_enabled: enabled })
		.eq("id", true);
	if (error) throw new Error(`crawl scheduler E2E 설정 실패: ${error.message}`);
}

export async function seedCrawlRun(options: SeedCrawlRunOptions) {
	const supabase = createAdminClient();
	const suffix = Math.floor(Math.random() * 1_000_000_000)
		.toString()
		.padStart(12, "0");
	const running = options.status === "running";
	const startedAt = new Date(options.startedAt);
	const { data, error } = await supabase
		.from("crawl_runs")
		.insert({
			source: options.source,
			lock_token: `20000000-0000-4000-8000-${suffix}`,
			status: options.status,
			started_at: options.startedAt,
			stale_after: new Date(startedAt.getTime() + 5 * 60 * 1000).toISOString(),
			finished_at: running ? null : new Date(startedAt.getTime() + 7000).toISOString(),
			duration_ms: running ? null : 7000,
			retry_count: 0,
			attempted_count: running ? 0 : 3,
			succeeded_count: running ? 0 : 3,
			extracted_count: running ? 0 : 12,
			inserted_count: running ? 0 : 4,
			skipped_count: running ? 0 : 8,
			warning_count: 0,
			failure_count: 0,
			network_failure_count: 0,
			parser_failure_count: 0,
			timeout_failure_count: 0,
			parser_valid_count: running ? 0 : 12,
			parser_minimum_count: 10,
			warnings: [],
			failures: [],
			parser_observations: [],
		})
		.select("id")
		.single();
	if (error) throw new Error(`crawl_runs E2E 데이터 생성 실패: ${error.message}`);
	return String(data.id);
}

export async function completeCrawlRun(runId: string) {
	const supabase = createAdminClient();
	const { error } = await supabase
		.from("crawl_runs")
		.update({
			status: "succeeded",
			finished_at: new Date().toISOString(),
			duration_ms: 1000,
			attempted_count: 3,
			succeeded_count: 3,
			extracted_count: 10,
			inserted_count: 10,
			parser_valid_count: 10,
			parser_minimum_count: 10,
		})
		.eq("id", runId);
	if (error) throw new Error(`crawl_runs E2E 완료 처리 실패: ${error.message}`);
}

export async function countThreads(state: E2EThreadState) {
	const supabase = createAdminClient();
	const { count, error } = await supabase
		.from("threads")
		.select("id", { count: "exact", head: true })
		.eq("state", state);
	if (error) throw new Error(`${state} E2E 데이터 집계 실패: ${error.message}`);
	return count ?? 0;
}

export async function getThreadIdByUrl(state: E2EThreadState, url: string) {
	const supabase = createAdminClient();
	const { data, error } = await supabase
		.from("threads")
		.select("id")
		.eq("state", state)
		.eq("url", url)
		.maybeSingle();
	if (error) throw new Error(`${state} E2E 스레드 조회 실패: ${error.message}`);
	return data ? String(data.id) : null;
}

export async function seedThreads(
	state: E2EThreadState,
	count: number,
	options: SeedThreadOptions = {}
) {
	const supabase = createAdminClient();
	const prefix = options.prefix ?? state;
	const startAt = new Date("2026-07-21T00:00:00.000Z");
	const rows = Array.from({ length: count }, (_, index) => {
		const capturedAt = new Date(startAt.getTime() - index * 1000).toISOString();
		return {
			type: "arcalive",
			url: `https://e2e.applemint.local/${prefix}/${index + 1}`,
			title: `${prefix} thread ${String(index + 1).padStart(2, "0")}`,
			description: `E2E ${state} fixture ${index + 1}`,
			host: "e2e.applemint.local",
			tag: ["arcalive"],
			created_at: capturedAt,
			captured_at: capturedAt,
			state_changed_at: capturedAt,
			state,
		};
	});
	const { data, error } = await supabase.from("threads").insert(rows).select("id,url,title");
	if (error) throw new Error(`${state} E2E 데이터 생성 실패: ${error.message}`);
	return data;
}
