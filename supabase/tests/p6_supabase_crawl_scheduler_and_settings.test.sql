begin;

select plan(28);

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
	'{"arcalive":[7200,7200],"battlepage":[14400,14400],"insagirl":[10800,10800]}'::jsonb,
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
	3,
	'owner policy response includes all active sources'
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
set schedule_enabled = true, cooldown_seconds = recommended_cooldown_seconds;

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

select * from finish();
rollback;
