-- Scheduling policy, lock, dispatch, reconciliation, and fail-closed contract.
begin;

select plan(66);

select has_table('public', 'crawl_source_policies', 'source scheduling policy table exists');
select has_table('public', 'crawl_runtime_settings', 'crawl runtime singleton exists');
select is(
	(select count(*) from public.crawl_source_policies),
	4::bigint,
	'exactly four active source policies are seeded'
);
select is(
	(
		select row(cooldown_seconds, run_budget_seconds, schedule_enabled)
		from public.crawl_source_policies where source = 'battlepage'
	),
	row(14400, 45, true),
	'battlepage policy defaults to four hours and a 45 second budget'
);
select is(
	(
		select row(cooldown_seconds, recommended_cooldown_seconds, run_budget_seconds, schedule_enabled)
		from public.crawl_source_policies where source = 'issuelink'
	),
	row(10800, 10800, 45, false),
	'IssueLink starts disabled with the three-hour policy and a 45 second budget'
);
select is(
	(
		select row(max_concurrency, lock_ttl_seconds, heartbeat_interval_seconds)
		from public.crawl_runtime_settings where id = true
	),
	row(2, 60, 15),
	'global runtime defaults are seeded'
);
select ok(
	has_function_privilege('service_role', 'public.begin_scheduled_crawl_run(text,uuid,integer)', 'EXECUTE')
		and has_function_privilege('service_role', 'public.heartbeat_crawl_run(bigint,uuid)', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.begin_scheduled_crawl_run(text,uuid,integer)', 'EXECUTE'),
	'only service role can execute scheduling and heartbeat RPCs'
);
select is(
	(
		select count(*) from cron.job
		where jobname = 'applemint-recover-stale-crawl-runs' and schedule = '*/5 * * * *'
	),
	1::bigint,
	'stale recovery runs every five minutes'
);

create temporary table p5_state (key text primary key, value jsonb not null);
grant all on table p5_state to service_role;

set local role service_role;
select throws_ok(
	$$select public.begin_crawl_run('dogdrip', '50000000-0000-4000-8000-000000000010'::uuid, 300)$$,
	'22023',
	'Unsupported crawl source.',
	'retired Dogdrip source cannot start a crawl run'
);
reset role;

set local role service_role;
insert into p5_state values (
	'arcalive',
	public.begin_crawl_run('arcalive', '50000000-0000-4000-8000-000000000001'::uuid, 300)
);
insert into p5_state values (
	'arcalive-duplicate',
	public.begin_crawl_run('arcalive', '50000000-0000-4000-8000-000000000002'::uuid, 300)
);
insert into p5_state values (
	'battlepage',
	public.begin_crawl_run('battlepage', '50000000-0000-4000-8000-000000000003'::uuid, 300)
);
insert into p5_state values (
	'insagirl-capacity',
	public.begin_crawl_run('insagirl', '50000000-0000-4000-8000-000000000004'::uuid, 300)
);
reset role;

select is((select value ->> 'acquired' from p5_state where key = 'arcalive'), 'true', 'first source acquires its lease');
select is((select value ->> 'reason' from p5_state where key = 'arcalive-duplicate'), 'source-busy', 'same source overlap is rejected');
select is((select value ->> 'acquired' from p5_state where key = 'battlepage'), 'true', 'different source can run in parallel');
select is((select value ->> 'reason' from p5_state where key = 'insagirl-capacity'), 'capacity', 'third source is rejected by max concurrency');
select is(
	(select count(*) from public.crawl_run_locks where lock_key like 'crawl:%'),
	2::bigint,
	'only two source leases are active'
);

set local role service_role;
select public.finish_crawl_run(
	(select (value ->> 'runId')::bigint from p5_state where key = 'arcalive'),
	'50000000-0000-4000-8000-000000000001'::uuid,
	'{"status":"succeeded","recoveredCount":2}'::jsonb
);
select public.finish_crawl_run(
	(select (value ->> 'runId')::bigint from p5_state where key = 'battlepage'),
	'50000000-0000-4000-8000-000000000003'::uuid,
	'{"status":"succeeded"}'::jsonb
);
insert into p5_state values (
	'arcalive-cooldown',
	public.begin_scheduled_crawl_run('arcalive', '50000000-0000-4000-8000-000000000005'::uuid, 60)
);
insert into p5_state values (
	'arcalive-manual',
	public.begin_crawl_run('arcalive', '50000000-0000-4000-8000-000000000006'::uuid, 60)
);
reset role;

select is(
	(select recovered_count from public.crawl_runs where lock_token = '50000000-0000-4000-8000-000000000001'::uuid),
	2,
	'finish stores recovered page count'
);
select is((select value ->> 'reason' from p5_state where key = 'arcalive-cooldown'), 'cooldown', 'scheduled run observes last-finished cooldown');
select is((select value ->> 'acquired' from p5_state where key = 'arcalive-manual'), 'true', 'manual run bypasses cooldown');

set local role service_role;
insert into p5_state values (
	'heartbeat',
	public.heartbeat_crawl_run(
		(select (value ->> 'runId')::bigint from p5_state where key = 'arcalive-manual'),
		'50000000-0000-4000-8000-000000000006'::uuid
	)
);
insert into p5_state values (
	'heartbeat-wrong-token',
	public.heartbeat_crawl_run(
		(select (value ->> 'runId')::bigint from p5_state where key = 'arcalive-manual'),
		'50000000-0000-4000-8000-000000000099'::uuid
	)
);
reset role;

select is((select value ->> 'renewed' from p5_state where key = 'heartbeat'), 'true', 'matching heartbeat extends the lease');
select is((select value ->> 'renewed' from p5_state where key = 'heartbeat-wrong-token'), 'false', 'wrong heartbeat token cannot extend the lease');
select ok(
	(select last_heartbeat_at is not null from public.crawl_runs where lock_token = '50000000-0000-4000-8000-000000000006'::uuid),
	'heartbeat timestamp is persisted'
);

set local role service_role;
select public.finish_crawl_run(
	(select (value ->> 'runId')::bigint from p5_state where key = 'arcalive-manual'),
	'50000000-0000-4000-8000-000000000006'::uuid,
	'{"status":"succeeded"}'::jsonb
);
update public.crawl_source_policies set schedule_enabled = false where source = 'insagirl';
insert into p5_state values (
	'insagirl-disabled',
	public.begin_scheduled_crawl_run('insagirl', '50000000-0000-4000-8000-000000000007'::uuid, 60)
);
reset role;

select is((select value ->> 'reason' from p5_state where key = 'insagirl-disabled'), 'disabled', 'disabled schedule is skipped');

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, run_trigger, last_heartbeat_at
)
values (
	'insagirl',
	'50000000-0000-4000-8000-000000000008'::uuid,
	'running',
	now() - interval '5 minutes',
	now() - interval '1 minute',
	'scheduled',
	now() - interval '2 minutes'
);
insert into public.crawl_run_locks (lock_key, lock_token, locked_until)
values (
	'crawl:insagirl',
	'50000000-0000-4000-8000-000000000008'::uuid,
	now() - interval '1 minute'
);

select is(public.recover_stale_crawl_runs(), 1::bigint, 'stale recovery marks one expired run');
select is(
	(select status from public.crawl_runs where lock_token = '50000000-0000-4000-8000-000000000008'::uuid),
	'interrupted',
	'stale run is persisted as interrupted'
);
select is(
	(select count(*) from public.crawl_run_locks where lock_token = '50000000-0000-4000-8000-000000000008'::uuid),
	0::bigint,
	'expired source lease is removed'
);

set local role service_role;
insert into p5_state values (
	'legacy-release',
	public.begin_crawl_run('battlepage', '50000000-0000-4000-8000-000000000009'::uuid, 60)
);
select public.release_crawl_lock('global-crawl', '50000000-0000-4000-8000-000000000009'::uuid);
reset role;

select is(
	(select count(*) from public.crawl_run_locks where lock_token = '50000000-0000-4000-8000-000000000009'::uuid),
	0::bigint,
	'legacy global release removes the matching source lease'
);

set local role service_role;
select public.finish_crawl_run(
	(select (value ->> 'runId')::bigint from p5_state where key = 'legacy-release'),
	'50000000-0000-4000-8000-000000000009'::uuid,
	'{"status":"succeeded"}'::jsonb
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	jsonb_array_length(public.get_crawl_runs_dashboard(20, 20) -> 'activeRuns'),
	0,
	'dashboard returns an active run array for parallel execution'
);
select is(
	public.get_crawl_runs_dashboard(20, 20) #>> '{runtimeSettings,maxConcurrency}',
	'2',
	'dashboard exposes runtime concurrency settings'
);
reset role;

-- Isolate the dispatch contract from the lock lifecycle fixtures above.
delete from public.crawl_schedule_dispatches;
delete from public.crawl_run_locks;
delete from public.crawl_runs;
update public.crawl_source_policies
set
	schedule_enabled = source <> 'issuelink',
	cooldown_seconds = recommended_cooldown_seconds;

select has_extension('pg_net', 'pg_net extension is available for asynchronous dispatch');
select has_extension('supabase_vault', 'Vault extension is available for scheduler secrets');
select has_table('public', 'crawl_schedule_dispatches', 'scheduler dispatch audit table exists');
select has_column(
	'public',
	'crawl_source_policies',
	'recommended_cooldown_seconds',
	'source policy stores its recommended baseline'
);
select has_column(
	'public',
	'crawl_runtime_settings',
	'scheduler_enabled',
	'runtime singleton exposes the scheduler cutover switch'
);
select is(
	(
		select jsonb_object_agg(
			source,
			jsonb_build_array(cooldown_seconds, recommended_cooldown_seconds)
		)
		from public.crawl_source_policies
	),
	'{"arcalive":[7200,7200],"battlepage":[14400,14400],"insagirl":[10800,10800],"issuelink":[10800,10800]}'::jsonb,
	'optimized source cooldowns and recommendations are seeded'
);
select is(
	(select scheduler_enabled from public.crawl_runtime_settings where id = true),
	false,
	'Supabase scheduler is disabled until the deployment cutover'
);
select ok(
	not has_table_privilege('authenticated', 'public.crawl_schedule_dispatches', 'SELECT')
		and has_table_privilege('service_role', 'public.crawl_schedule_dispatches', 'INSERT,UPDATE,DELETE'),
	'dispatch audit rows are not directly exposed to authenticated clients'
);
select ok(
	has_function_privilege('authenticated', 'public.get_crawl_source_policy_settings()', 'EXECUTE')
		and has_function_privilege(
			'authenticated',
			'public.update_crawl_source_policy(text,boolean,integer,timestamp with time zone)',
			'EXECUTE'
		)
		and not has_function_privilege('anon', 'public.get_crawl_source_policy_settings()', 'EXECUTE'),
	'only authenticated owners receive policy RPC access'
);
select ok(
	has_function_privilege('service_role', 'public.dispatch_due_crawl_sources()', 'EXECUTE')
		and has_function_privilege('service_role', 'public.reconcile_crawl_schedule_dispatches()', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.dispatch_due_crawl_sources()', 'EXECUTE'),
	'scheduler maintenance functions are restricted from authenticated clients'
);
select is(
	(
		select count(*) from cron.job
		where jobname = 'applemint-dispatch-due-crawl-sources' and schedule = '*/5 * * * *'
	),
	1::bigint,
	'due source dispatcher runs every five minutes'
);
select is(
	(
		select count(*) from cron.job
		where jobname = 'applemint-reconcile-crawl-dispatches' and schedule = '* * * * *'
	),
	1::bigint,
	'pg_net response reconciliation runs every minute'
);
select is(
	(
		select count(*) from cron.job
		where jobname = 'applemint-clean-crawl-dispatches' and schedule = '35 18 * * *'
	),
	1::bigint,
	'dispatch audit cleanup runs daily'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	public.get_crawl_source_policy_settings() ->> 'schedulerEnabled',
	'false',
	'owner policy response includes the global scheduler state'
);
select is(
	jsonb_array_length(public.get_crawl_source_policy_settings() -> 'sources'),
	4,
	'owner policy response includes all four active sources'
);
select throws_ok(
	$$select public.update_crawl_source_policy('dogdrip', true, 10800, now())$$,
	'22023',
	'Unsupported crawl source.',
	'owner cannot restore the retired Dogdrip policy'
);
reset role;

update public.crawl_runtime_settings set scheduler_enabled = true where id = true;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	(
		select (source ->> 'cooldownSeconds')::integer
		from jsonb_array_elements(public.get_crawl_source_policy_settings() -> 'sources') as source
		where source ->> 'source' = 'battlepage'
	),
	14400,
	'policy response exposes the optimized Battlepage interval'
);
select is(
	(
		select extract(epoch from (source ->> 'nextScheduledAt')::timestamp with time zone)::bigint % 300
		from jsonb_array_elements(public.get_crawl_source_policy_settings() -> 'sources') as source
		where source ->> 'source' = 'battlepage'
	),
	0::bigint,
	'next scheduled timestamp is rounded to a five-minute boundary'
);

create temporary table p6_update_state (key text primary key, value jsonb not null);
insert into p6_update_state values (
	'updated',
	public.update_crawl_source_policy(
		'arcalive',
		false,
		3600,
		(
			select (source ->> 'updatedAt')::timestamp with time zone
			from jsonb_array_elements(public.get_crawl_source_policy_settings() -> 'sources') as source
			where source ->> 'source' = 'arcalive'
		)
	)
);
insert into p6_update_state values (
	'conflict',
	public.update_crawl_source_policy(
		'arcalive',
		true,
		7200,
		'2000-01-01 00:00:00+00'::timestamp with time zone
	)
);
reset role;

select is(
	(select value ->> 'updated' from p6_update_state where key = 'updated'),
	'true',
	'owner can update schedule state and cooldown together'
);
select is(
	(select value ->> 'reason' from p6_update_state where key = 'conflict'),
	'conflict',
	'stale expected timestamp is rejected as a policy conflict'
);

update public.crawl_source_policies
set schedule_enabled = true, cooldown_seconds = recommended_cooldown_seconds
where source <> 'issuelink';

select is(
	(
		select array_agg(source order by source)
		from public._select_due_crawl_sources(
			'2026-07-22 12:01:00+00',
			'2026-07-22 12:00:00+00',
			2
		)
	),
	array['arcalive', 'battlepage']::text[],
	'empty history selects only the available number of sources in stable order'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, finished_at, stale_after, duration_ms
)
values
	(
		'arcalive',
		'60000000-0000-4000-8000-000000000001'::uuid,
		'succeeded',
		'2026-07-22 10:59:00+00',
		'2026-07-22 11:00:00+00',
		'2026-07-22 11:00:00+00',
		60000
	),
	(
		'battlepage',
		'60000000-0000-4000-8000-000000000002'::uuid,
		'succeeded',
		'2026-07-22 06:59:00+00',
		'2026-07-22 07:00:00+00',
		'2026-07-22 07:00:00+00',
		60000
	);
insert into public.crawl_run_locks (lock_key, lock_token, locked_until)
values (
	'crawl:insagirl',
	'60000000-0000-4000-8000-000000000003'::uuid,
	'2026-07-22 12:02:00+00'
);

select is(
	(
		select string_agg(source, ',')
		from public._select_due_crawl_sources(
			'2026-07-22 12:01:00+00',
			'2026-07-22 12:00:00+00',
			2
		)
	),
	'battlepage',
	'cooldown and an active source lease remove ineligible sources'
);

insert into public.crawl_schedule_dispatches (scheduled_for, source, state)
values ('2026-07-22 12:00:00+00', 'battlepage', 'queued');

select is(
	(
		select count(*)
		from public._select_due_crawl_sources(
			'2026-07-22 12:01:00+00',
			'2026-07-22 12:00:00+00',
			2
		)
	),
	0::bigint,
	'same source and five-minute bucket are not selected twice'
);

delete from vault.secrets
where name in ('crawl_app_base_url', 'crawl_internal_secret');

set local role service_role;
select is(
	public.dispatch_due_crawl_sources() ->> 'status',
	'configuration-missing',
	'missing Vault configuration produces no external dispatch'
);
reset role;

update public.crawl_runtime_settings set scheduler_enabled = false where id = true;
set local role service_role;
select is(
	public.dispatch_due_crawl_sources() ->> 'status',
	'disabled',
	'disabled global scheduler exits before reading dispatch configuration'
);
reset role;

insert into public.crawl_schedule_dispatches (
	scheduled_for, source, request_id, state, created_at
)
values (
	'2026-07-22 12:05:00+00',
	'arcalive',
	999999999,
	'queued',
	now() - interval '3 minutes'
);
set local role service_role;
select is(
	public.reconcile_crawl_schedule_dispatches(),
	1::bigint,
	'reconciler settles a queued request after its response timeout'
);
reset role;
select is(
	(
		select state from public.crawl_schedule_dispatches
		where request_id = 999999999
	),
	'expired',
	'timed-out dispatch audit is marked expired'
);

insert into public.crawl_schedule_dispatches (
	scheduled_for, source, state, created_at, resolved_at
)
values (
	'2026-06-01 00:00:00+00',
	'insagirl',
	'expired',
	now() - interval '31 days',
	now() - interval '31 days'
);
select is(
	public.cleanup_crawl_schedule_dispatches(),
	1::bigint,
	'cleanup removes dispatch audit older than thirty days'
);

select throws_ok(
	$$update public.crawl_source_policies set cooldown_seconds = 3630 where source = 'arcalive'$$,
	'23514',
	null,
	'cooldown must be stored in whole-minute increments'
);

select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-evaluate-crawl-alerts'
			and schedule = '5,20,35,50 * * * *'
	),
	1::bigint,
	'crawl alert evaluation runs once every fifteen minutes before delivery'
);

select is(
	(
		select command
		from cron.job
		where jobname = 'applemint-evaluate-crawl-alerts'
	),
	'select public.evaluate_crawl_alerts(now())',
	'cron evaluates alert state inside Postgres'
);

update public.crawl_runtime_settings set scheduler_enabled = true where id = true;

insert into public.crawl_schedule_dispatches (
	scheduled_for, source, request_id, state
)
values ('2026-07-22 16:00:00+00', 'arcalive', 8800001, 'queued');

insert into net._http_response (
	id, status_code, content_type, headers, content, timed_out, error_msg
)
values (
	8800001,
	401,
	'application/json',
	'{}'::jsonb,
	'{"error":"unauthorized","reason":"invalid-secret"}',
	false,
	null
);

set local role service_role;
select is(
	public.reconcile_crawl_schedule_dispatches(),
	1::bigint,
	'reconciler settles an authentication failure'
);
reset role;

select is(
	(select state from public.crawl_schedule_dispatches where request_id = 8800001),
	'failed',
	'authentication response is recorded as failed'
);
select is(
	(select admission_reason from public.crawl_schedule_dispatches where request_id = 8800001),
	'invalid-secret',
	'endpoint authentication reason is preserved for operations'
);
select is(
	(select scheduler_enabled from public.crawl_runtime_settings where id = true),
	false,
	'authentication failure disables scheduled dispatches'
);
select is(
	(select response_body ->> 'error' from public.crawl_schedule_dispatches where request_id = 8800001),
	'unauthorized',
	'safe response details remain available in the dispatch audit'
);

update public.crawl_runtime_settings set scheduler_enabled = true where id = true;

insert into public.crawl_schedule_dispatches (
	scheduled_for, source, request_id, state
)
values ('2026-07-22 16:05:00+00', 'battlepage', 8800002, 'queued');

insert into net._http_response (
	id, status_code, content_type, headers, content, timed_out, error_msg
)
values (
	8800002,
	503,
	'application/json',
	'{}'::jsonb,
	'{"error":"configuration missing","reason":"configuration-missing"}',
	false,
	null
);

set local role service_role;
select is(
	public.reconcile_crawl_schedule_dispatches(),
	1::bigint,
	'reconciler settles an authentication configuration failure'
);
reset role;

select is(
	(select admission_reason from public.crawl_schedule_dispatches where request_id = 8800002),
	'configuration-missing',
	'authentication configuration reason is preserved for operations'
);
select is(
	(select scheduler_enabled from public.crawl_runtime_settings where id = true),
	false,
	'authentication configuration failure disables scheduled dispatches'
);

select * from finish();
rollback;
