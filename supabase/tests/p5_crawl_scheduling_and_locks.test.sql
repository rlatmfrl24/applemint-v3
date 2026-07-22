begin;

select plan(25);

select has_table('public', 'crawl_source_policies', 'source scheduling policy table exists');
select has_table('public', 'crawl_runtime_settings', 'crawl runtime singleton exists');
select is(
	(select count(*) from public.crawl_source_policies),
	3::bigint,
	'exactly three active source policies are seeded'
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

select * from finish();
rollback;
