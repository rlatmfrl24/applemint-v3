-- Crawl run lifecycle, permanent history, and retained legacy history contract.
begin;

select plan(42);

select ok(
	not has_function_privilege('anon', 'public.cleanup_crawl_runs()', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.cleanup_crawl_runs()', 'EXECUTE')
		and not has_function_privilege('service_role', 'public.cleanup_crawl_runs()', 'EXECUTE'),
	'cleanup RPC is reserved for the database scheduler'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-clean-crawl-runs'
			and schedule = '15 18 * * *'
	),
	1::bigint,
	'daily 90-day cleanup schedule exists'
);

create temporary table p2_run_state (key text primary key, value jsonb not null);
grant all on table p2_run_state to service_role;

set local role service_role;
insert into p2_run_state (key, value)
values (
	'first',
	public.begin_crawl_run(
		'arcalive',
		'10000000-0000-4000-8000-000000000001'::uuid,
		300
	)
);
reset role;

select is(
	(select value ->> 'acquired' from p2_run_state where key = 'first'),
	'true',
	'begin RPC acquires the source lock'
);
select is(
	(
		select count(*)
		from public.crawl_runs
		where id = (select (value ->> 'runId')::bigint from p2_run_state where key = 'first')
			and status = 'running'
	),
	1::bigint,
	'begin RPC creates one running history row'
);

set local role service_role;
insert into p2_run_state (key, value)
values (
	'second',
	public.begin_crawl_run(
		'battlepage',
		'10000000-0000-4000-8000-000000000002'::uuid,
		300
	)
);
reset role;

select is(
	(select value ->> 'acquired' from p2_run_state where key = 'second'),
	'true',
	'a different source can acquire a parallel lock'
);
select is(
	(
		select count(*)
		from public.crawl_runs
		where lock_token in (
			'10000000-0000-4000-8000-000000000001'::uuid,
			'10000000-0000-4000-8000-000000000002'::uuid
		)
	),
	2::bigint,
	'parallel source lock creates a second history row'
);

set local role service_role;
insert into p2_run_state (key, value)
select
	'finished',
	public.finish_crawl_run(
		(value ->> 'runId')::bigint,
		'10000000-0000-4000-8000-000000000001'::uuid,
		jsonb_build_object(
			'status', 'partial',
			'retryCount', 1,
			'attemptedCount', 6,
			'succeededCount', 3,
			'extractedCount', 12,
			'insertedCount', 4,
			'skippedCount', 8,
			'warningCount', 1,
			'failureCount', 3,
			'networkFailureCount', 1,
			'parserFailureCount', 1,
			'timeoutFailureCount', 1,
			'parserValidCount', 12,
			'parserMinimumCount', 10,
			'warnings', '[{"code":"below-minimum-items","attempt":2}]'::jsonb,
			'failures', '[{"kind":"network"},{"kind":"parser"},{"kind":"network","timeout":true}]'::jsonb,
			'parserObservations', '[{"attempt":2,"status":"ok","validCount":12,"minimumItems":10}]'::jsonb
		)
	)
	from p2_run_state
	where key = 'first';
reset role;

select is(
	(select value ->> 'status' from p2_run_state where key = 'finished'),
	'partial',
	'finish RPC returns the terminal status'
);
select is(
	(
		select row(retry_count, attempted_count, succeeded_count, inserted_count, skipped_count)
		from public.crawl_runs
		where status = 'partial'
	),
	row(1, 6, 3, 4, 8),
	'finish RPC stores execution counters'
);
select is(
	(
		select row(
			network_failure_count,
			parser_failure_count,
			timeout_failure_count,
			jsonb_array_length(warnings),
			jsonb_array_length(failures)
		)
		from public.crawl_runs
		where status = 'partial'
	),
	row(1, 1, 1, 1, 3),
	'failure causes and JSON details are preserved'
);
select is(
	(select count(*) from public.crawl_run_locks where lock_key = 'crawl:arcalive'),
	0::bigint,
	'finish RPC releases only its matching source lock'
);

set local role service_role;
select public.finish_crawl_run(
	(select (value ->> 'runId')::bigint from p2_run_state where key = 'second'),
	'10000000-0000-4000-8000-000000000002'::uuid,
	'{"status":"succeeded"}'::jsonb
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
	$$select public.get_crawl_runs_dashboard(20, 20)$$,
	'42501',
	'Only the Applemint owner can read crawl run history.',
	'non-owner cannot read the dashboard'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	jsonb_array_length(public.get_crawl_runs_dashboard(20, 20) -> 'sources'),
	4,
	'owner dashboard always contains the four active sources'
);
reset role;

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after
)
values (
	'insagirl',
	'10000000-0000-4000-8000-000000000003'::uuid,
	'running',
	now() - interval '10 minutes',
	now() - interval '5 minutes'
);
insert into public.crawl_run_locks (lock_key, lock_token, locked_until)
values (
	'crawl:insagirl',
	'10000000-0000-4000-8000-000000000003'::uuid,
	now() - interval '5 minutes'
);

set local role service_role;
insert into p2_run_state (key, value)
values (
	'after-stale',
	public.begin_crawl_run(
		'arcalive',
		'10000000-0000-4000-8000-000000000004'::uuid,
		300
	)
);
reset role;

select is(
	(select value ->> 'acquired' from p2_run_state where key = 'after-stale'),
	'true',
	'an expired lock can be acquired by the next run'
);
select is(
	(
		select status
		from public.crawl_runs
		where lock_token = '10000000-0000-4000-8000-000000000003'::uuid
	),
	'interrupted',
	'next begin persists the stale running row as interrupted'
);

set local role service_role;
select public.finish_crawl_run(
	(select (value ->> 'runId')::bigint from p2_run_state where key = 'after-stale'),
	'10000000-0000-4000-8000-000000000004'::uuid,
	'{"status":"succeeded"}'::jsonb
);
reset role;

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms
)
values
	(
		'arcalive',
		'10000000-0000-4000-8000-000000000005'::uuid,
		'failed',
		now() - interval '91 days',
		now() - interval '91 days' + interval '5 minutes',
		now() - interval '91 days' + interval '1 minute',
		60000
	),
	(
		'arcalive',
		'10000000-0000-4000-8000-000000000006'::uuid,
		'succeeded',
		now() - interval '89 days',
		now() - interval '89 days' + interval '5 minutes',
		now() - interval '89 days' + interval '1 minute',
		60000
	);

select is(public.cleanup_crawl_runs(), 1::bigint, 'cleanup deletes completed runs older than 90 days');
select is(
	(
		select count(*)
		from public.crawl_runs
		where lock_token = '10000000-0000-4000-8000-000000000006'::uuid
	),
	1::bigint,
	'cleanup preserves recent crawl runs'
);

set local role service_role;
select is(
	(public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://retention.test/permanent","title":"permanent history","host":"retention.test"}]'::jsonb
	) ->> 'insertedCount')::integer,
	1,
	'first ingest inserts a previously unseen URL'
);
reset role;

select is(
	(select count(*) from public."crawl-history" where url = 'https://retention.test/permanent'),
	1::bigint,
	'first ingest creates one permanent history row'
);
select is(
	(select count(*) from public.threads where url = 'https://retention.test/permanent' and state = 'inbox'),
	1::bigint,
	'first ingest creates one visible thread'
);

delete from public.threads where url = 'https://retention.test/permanent';

set local role service_role;
select is(
	(public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://retention.test/permanent","title":"recrawled history","host":"retention.test"}]'::jsonb
	) ->> 'insertedCount')::integer,
	0,
	'a removed visible URL is not inserted again'
);
select is(
	(public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://retention.test/permanent","title":"recrawled history","host":"retention.test"}]'::jsonb
	) ->> 'skippedCount')::integer,
	1,
	'a removed visible URL is reported as skipped'
);
reset role;

select is(
	(select count(*) from public."crawl-history" where url = 'https://retention.test/permanent'),
	1::bigint,
	'repeated ingest preserves exactly one history row'
);
select is(
	(select count(*) from public.threads where url = 'https://retention.test/permanent'),
	0::bigint,
	'repeated ingest does not recreate the removed visible thread'
);

insert into public."crawl-history" (created_at, url, crawl_source, host)
values (
	now() - interval '400 days',
	'https://retention.test/old-history',
	'battlepage',
	'retention.test'
);

select lives_ok(
	$$select public.cleanup_crawl_runs()$$,
	'crawl run cleanup completes while permanent history exists'
);
select is(
	(select count(*) from public."crawl-history" where url = 'https://retention.test/old-history'),
	1::bigint,
	'crawl run cleanup preserves old crawl history'
);
select is(
	(
		select count(*)
		from pg_partitioned_table
		where partrelid = 'public."crawl-history"'::regclass
	),
	0::bigint,
	'crawl history remains an unpartitioned table'
);
select ok(
	exists (
		select 1
		from pg_index
		where indrelid = 'public."crawl-history"'::regclass
			and indexrelid = 'public.idx_crawl_history_source_url_unique'::regclass
			and indisunique
	),
	'crawl history retains its source and URL unique index'
);
select ok(
	not exists (
		select 1
		from cron.job
		where command ilike '%crawl-history%'
	),
	'no scheduled job deletes or archives crawl history'
);

set local role service_role;
select is(
	(public.ingest_crawl_items(
		'issuelink',
		'[{"url":"https://legacy.test/issue","title":"IssueLink normal","host":"https://www.fmkorea.com","type":"normal","tag":["issuelink","fmkorea"]}]'::jsonb
	) ->> 'insertedCount')::integer,
	1,
	'IssueLink can ingest a normal thread'
);
select is(
	(
		select row(type, host, tag)
		from public.threads where url = 'https://legacy.test/issue'
	),
	row('normal'::text, 'https://www.fmkorea.com'::text, array['issuelink', 'fmkorea']::text[]),
	'IssueLink preserves normal type, original host, and provenance tags'
);
select is(
	(public.ingest_crawl_items(
		'issuelink',
		'[{"url":"https://legacy.test/issue","title":"duplicate","host":"https://www.fmkorea.com","type":"normal"}]'::jsonb
	) ->> 'insertedCount')::integer,
	0,
	'a second IssueLink ingest inserts no duplicate'
);
select throws_ok(
	$$select public.ingest_crawl_items('issuelink', '[{"url":"https://legacy.test/retired-type","type":"issuelink"}]'::jsonb)$$,
	'23514',
	'Retired thread types cannot be ingested.',
	'the retired IssueLink thread type remains rejected'
);
select lives_ok(
	$$select public.begin_crawl_run('issuelink', '40000000-0000-4000-8000-000000000001'::uuid, 300)$$,
	'IssueLink can start through the shared crawl run contract'
);
reset role;

insert into public."crawl-history" (url, crawl_source, host)
values ('https://legacy.test/issue-history', 'issuelink', 'legacy.test');

select is(
	(
		select count(*)
		from public."crawl-history"
		where crawl_source = 'issuelink' and url = 'https://legacy.test/issue-history'
	),
	1::bigint,
	'legacy IssueLink crawl history remains preservable'
);

set local role service_role;
select is(
	(public.ingest_crawl_items(
		'issuelink',
		'[{"url":"https://legacy.test/issue-history","title":"historical duplicate","type":"normal"}]'::jsonb
	) ->> 'insertedCount')::integer,
	0,
	'preserved IssueLink crawl history prevents reingestion'
);
reset role;

select is(
	(
		select pg_get_constraintdef(oid)
		from pg_constraint
		where conrelid = 'public.crawl_runs'::regclass and conname = 'crawl_runs_source_check'
	),
	'CHECK ((source = ANY (ARRAY[''arcalive''::text, ''battlepage''::text, ''insagirl''::text, ''issuelink''::text])))',
	'crawl runs preserve the legacy source value for historical rows'
);

select is(
	(
		select pg_get_constraintdef(oid)
		from pg_constraint
		where conrelid = 'public.crawl_alert_incidents'::regclass
			and conname = 'crawl_alert_incidents_source_check'
	),
	'CHECK ((source = ANY (ARRAY[''arcalive''::text, ''battlepage''::text, ''insagirl''::text, ''issuelink''::text])))',
	'crawl alert incidents preserve the legacy source value for historical rows'
);

set local role service_role;
insert into public.crawl_runs (
	source,
	lock_token,
	status,
	started_at,
	stale_after,
	finished_at,
	duration_ms
)
values (
	'issuelink',
	'40000000-0000-4000-8000-000000000002'::uuid,
	'succeeded',
	now() - interval '2 minutes',
	now() - interval '1 minute',
	now() - interval '1 minute',
	60000
);

insert into public.crawl_alert_incidents (
	source,
	status,
	active_signals,
	opened_at,
	last_observed_at,
	recovered_at,
	snapshot
)
values (
	'issuelink',
	'recovered',
	array['parser-failure'],
	now() - interval '2 minutes',
	now() - interval '1 minute',
	now() - interval '1 minute',
	'{}'::jsonb
);
reset role;

select is(
	(select count(*) from public.crawl_runs where source = 'issuelink'),
	2::bigint,
	'active and completed IssueLink crawl run history remains preservable'
);

select is(
	(select count(*) from public.crawl_alert_incidents where source = 'issuelink'),
	1::bigint,
	'recovered IssueLink incident history remains preservable'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	jsonb_array_length(public.get_crawl_runs_dashboard(20, 20) -> 'sources'),
	4,
	'crawl dashboard returns exactly four source summaries'
);
select ok(
	jsonb_path_exists(
		public.get_crawl_runs_dashboard(20, 20),
		'$.sources[*] ? (@.source == "issuelink")'
	),
	'crawl dashboard exposes IssueLink source policy'
);
select ok(
	jsonb_path_exists(
		public.get_crawl_runs_dashboard(20, 20),
		'$.runs[*] ? (@.source == "issuelink")'
	),
	'crawl dashboard exposes IssueLink run history'
);
reset role;

select * from finish();
rollback;
