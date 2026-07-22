begin;

select plan(23);

select has_table('public', 'crawl_runs', 'crawl run history table exists');
select ok(
	not has_table_privilege('anon', 'public.crawl_runs', 'SELECT'),
	'anon cannot read crawl run history directly'
);
select ok(
	not has_table_privilege('authenticated', 'public.crawl_runs', 'SELECT'),
	'authenticated users cannot read crawl run history directly'
);
select ok(
	has_table_privilege('service_role', 'public.crawl_runs', 'INSERT,UPDATE,DELETE'),
	'service role can maintain crawl run history'
);
select ok(
	not has_function_privilege('anon', 'public.begin_crawl_run(text,uuid,integer)', 'EXECUTE')
		and not has_function_privilege('anon', 'public.finish_crawl_run(bigint,uuid,jsonb)', 'EXECUTE')
		and not has_function_privilege('anon', 'public.get_crawl_runs_dashboard(integer,integer)', 'EXECUTE'),
	'anon cannot execute crawl run RPCs'
);
select ok(
	has_function_privilege('authenticated', 'public.get_crawl_runs_dashboard(integer,integer)', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.begin_crawl_run(text,uuid,integer)', 'EXECUTE'),
	'authenticated receives only the owner dashboard RPC'
);
select ok(
	has_function_privilege('service_role', 'public.begin_crawl_run(text,uuid,integer)', 'EXECUTE')
		and has_function_privilege('service_role', 'public.finish_crawl_run(bigint,uuid,jsonb)', 'EXECUTE')
		and not has_function_privilege('service_role', 'public.get_crawl_runs_dashboard(integer,integer)', 'EXECUTE'),
	'service role receives only crawl run mutation RPCs'
);
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
	'begin RPC acquires the global lock'
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
	'false',
	'competing begin RPC reports a lock conflict'
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
	1::bigint,
	'lock conflict does not create another history row'
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
	(select count(*) from public.crawl_run_locks where lock_key = 'global-crawl'),
	0::bigint,
	'finish RPC releases the matching lock'
);

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
	3,
	'owner dashboard always contains the three active sources'
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
	'global-crawl',
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

select * from finish();
rollback;
