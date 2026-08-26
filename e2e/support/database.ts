import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getE2ERuntime } from "./runtime";

export type E2EThreadState = "inbox" | "saved" | "trash";

interface SeedThreadOptions {
	prefix?: string;
}

interface SeedCrawlRunOptions {
	source: "arcalive" | "battlepage" | "insagirl" | "issuelink";
	status: "running" | "succeeded";
	startedAt: string;
}

interface SeededThread {
	id: string;
	url: string;
	title: string;
}

const DATABASE_CONTAINER_PATTERN = /^supabase_db_[A-Za-z0-9_.-]+$/u;
const BIGINT_PATTERN = /^(?:0|[1-9]\d*)$/u;

function sanitizeProcessError(value: string | undefined) {
	return (value?.trim() || "알 수 없는 로컬 PostgreSQL 오류")
		.replaceAll(/\s+/gu, " ")
		.slice(0, 500);
}

function runAdminSql(sql: string) {
	const { databaseContainer } = getE2ERuntime();
	if (!DATABASE_CONTAINER_PATTERN.test(databaseContainer)) {
		throw new Error("로컬 Supabase DB 컨테이너 이름이 유효하지 않습니다.");
	}

	const result = spawnSync(
		"docker",
		[
			"exec",
			"-i",
			databaseContainer,
			"psql",
			"-U",
			"postgres",
			"-d",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-At",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			input: `${sql.trim()}\n`,
			windowsHide: true,
		}
	);

	if (result.status !== 0) {
		const detail = sanitizeProcessError(result.stderr || result.error?.message);
		throw new Error(`로컬 PostgreSQL E2E 픽스처 실행에 실패했습니다: ${detail}`);
	}
	return result.stdout.trim();
}

function quoteLiteral(value: string) {
	if (value.includes("\0")) {
		throw new Error("PostgreSQL 문자열에 null 문자를 사용할 수 없습니다.");
	}
	return `'${value.replaceAll("'", "''")}'`;
}

function assertBigint(value: string, label: string) {
	if (!BIGINT_PATTERN.test(value)) {
		throw new Error(`${label}이 유효한 bigint가 아닙니다.`);
	}
	return value;
}

function assertSeedCount(value: number) {
	if (!Number.isSafeInteger(value) || value < 0 || value > 1000) {
		throw new Error("E2E 스레드 생성 수는 0~1000의 정수여야 합니다.");
	}
	return value;
}

function normalizeTimestamp(value: string, label: string) {
	const timestamp = new Date(value);
	if (Number.isNaN(timestamp.getTime())) {
		throw new Error(`${label}이 유효한 시간이 아닙니다.`);
	}
	return timestamp.toISOString();
}

export async function clearThreadTables() {
	runAdminSql("delete from public.threads;");
}

export async function clearCrawlRuns() {
	runAdminSql(`
		begin;
		delete from public.crawl_schedule_dispatches;
		delete from public.crawl_run_locks;
		delete from public.crawl_runs;
		commit;
	`);
}

export async function resetCrawlPolicies() {
	runAdminSql(`
		update public.crawl_source_policies
		set
			schedule_enabled = true,
			cooldown_seconds = case source
				when 'arcalive' then 7200
				when 'battlepage' then 14400
				when 'insagirl' then 10800
				when 'issuelink' then 10800
			end,
			recommended_cooldown_seconds = case source
				when 'arcalive' then 7200
				when 'battlepage' then 14400
				when 'insagirl' then 10800
				when 'issuelink' then 10800
			end,
			updated_at = now()
		where source in ('arcalive', 'battlepage', 'insagirl', 'issuelink');

		update public.crawl_runtime_settings
		set scheduler_enabled = false, updated_at = now()
		where id = true;
	`);
}

export async function setCrawlSchedulerEnabled(enabled: boolean) {
	runAdminSql(`
		update public.crawl_runtime_settings
		set scheduler_enabled = ${enabled ? "true" : "false"}, updated_at = now()
		where id = true;
	`);
}

export async function seedCrawlRun(options: SeedCrawlRunOptions) {
	const startedAt = normalizeTimestamp(options.startedAt, "수집 실행 시작 시간");
	const startedAtMs = new Date(startedAt).getTime();
	const running = options.status === "running";
	const finishedAt = new Date(startedAtMs + 7000).toISOString();
	const staleAfter = new Date(startedAtMs + 5 * 60 * 1000).toISOString();
	const output = runAdminSql(`
		insert into public.crawl_runs (
			source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
			retry_count, attempted_count, succeeded_count, extracted_count, inserted_count,
			skipped_count, warning_count, failure_count, network_failure_count,
			parser_failure_count, timeout_failure_count, parser_valid_count,
			parser_minimum_count, warnings, failures, parser_observations
		)
		values (
			${quoteLiteral(options.source)}, ${quoteLiteral(randomUUID())}::uuid,
			${quoteLiteral(options.status)}, ${quoteLiteral(startedAt)}::timestamptz,
			${quoteLiteral(staleAfter)}::timestamptz,
			${running ? "null" : `${quoteLiteral(finishedAt)}::timestamptz`},
			${running ? "null" : "7000"}, 0, ${running ? 0 : 3}, ${running ? 0 : 3},
			${running ? 0 : 12}, ${running ? 0 : 4}, ${running ? 0 : 8}, 0, 0, 0, 0, 0,
			${running ? 0 : 12}, 10, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
		)
		returning id;
	`);
	return assertBigint(output, "생성된 수집 실행 ID");
}

export async function completeCrawlRun(runId: string) {
	const validatedRunId = assertBigint(runId, "수집 실행 ID");
	runAdminSql(`
		update public.crawl_runs
		set
			status = 'succeeded',
			finished_at = now(),
			duration_ms = 1000,
			attempted_count = 3,
			succeeded_count = 3,
			extracted_count = 10,
			inserted_count = 10,
			parser_valid_count = 10,
			parser_minimum_count = 10
		where id = ${validatedRunId};
	`);
}

export async function countThreads(state: E2EThreadState) {
	const output = runAdminSql(`
		select count(*)::text
		from public.threads
		where state = ${quoteLiteral(state)};
	`);
	const validatedCount = assertBigint(output, `${state} E2E 데이터 수`);
	const count = Number(validatedCount);
	if (!Number.isSafeInteger(count)) {
		throw new Error(`${state} E2E 데이터 수가 안전한 정수 범위를 벗어났습니다.`);
	}
	return count;
}

export async function getThreadIdByUrl(state: E2EThreadState, url: string) {
	const output = runAdminSql(`
		select id::text
		from public.threads
		where state = ${quoteLiteral(state)} and url = ${quoteLiteral(url)}
		limit 1;
	`);
	return output ? assertBigint(output, `${state} E2E 스레드 ID`) : null;
}

export async function seedThreads(
	state: E2EThreadState,
	count: number,
	options: SeedThreadOptions = {}
) {
	const fixtureCount = assertSeedCount(count);
	const prefix = options.prefix ?? state;
	const output = runAdminSql(`
		with inserted as (
			insert into public.threads (
				type, url, title, description, host, tag, created_at, captured_at,
				state_changed_at, state
			)
			select
				'normal',
				${quoteLiteral(`https://e2e.applemint.local/${prefix}/`)} || item::text,
				${quoteLiteral(`${prefix} thread `)} || lpad(item::text, 2, '0'),
				${quoteLiteral(`E2E ${state} fixture `)} || item::text,
				'e2e.applemint.local',
				array['arcalive']::text[],
				'2026-07-21T00:00:00.000Z'::timestamptz - ((item - 1) * interval '1 second'),
				'2026-07-21T00:00:00.000Z'::timestamptz - ((item - 1) * interval '1 second'),
				'2026-07-21T00:00:00.000Z'::timestamptz - ((item - 1) * interval '1 second'),
				${quoteLiteral(state)}
			from generate_series(1, ${fixtureCount}) as item
			returning id, url, title
		)
		select coalesce(
			jsonb_agg(
				jsonb_build_object('id', id::text, 'url', url, 'title', title)
				order by id
			),
			'[]'::jsonb
		)::text
		from inserted;
	`);
	const rows = JSON.parse(output) as SeededThread[];
	if (rows.length !== fixtureCount) {
		throw new Error(`E2E 스레드 생성 수가 일치하지 않습니다: ${rows.length}/${fixtureCount}`);
	}
	return rows;
}
