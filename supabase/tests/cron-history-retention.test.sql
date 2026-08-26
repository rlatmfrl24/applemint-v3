-- pg_cron execution history is retained for 14 days and deleted in bounded batches.
begin;

select plan(16);

select has_function(
	'public',
	'cleanup_cron_job_run_details',
	array[]::text[],
	'cron history cleanup function exists'
);
select function_returns(
	'public',
	'cleanup_cron_job_run_details',
	array[]::text[],
	'bigint',
	'cron history cleanup reports the deleted row count'
);
select is(
	(
		select prosecdef
		from pg_proc
		where oid = 'public.cleanup_cron_job_run_details()'::regprocedure
	),
	true,
	'cron history cleanup is SECURITY DEFINER'
);
select is(
	(
		select proconfig
		from pg_proc
		where oid = 'public.cleanup_cron_job_run_details()'::regprocedure
	),
	array['search_path=""']::text[],
	'cron history cleanup has an empty search_path'
);
select is(
	(
		select pg_get_userbyid(proowner)
		from pg_proc
		where oid = 'public.cleanup_cron_job_run_details()'::regprocedure
	),
	'postgres',
	'cron history cleanup is owned by postgres'
);
select ok(
	(
		select lower(pg_get_functiondef(oid)) like '%history.ctid%'
			and lower(pg_get_functiondef(oid)) like '%limit 10000%'
			and lower(pg_get_functiondef(oid)) like '%for update skip locked%'
		from pg_proc
		where oid = 'public.cleanup_cron_job_run_details()'::regprocedure
	),
	'cron history cleanup uses a locked-safe bounded ctid batch'
);
select ok(
	not has_function_privilege('public', 'public.cleanup_cron_job_run_details()', 'EXECUTE')
		and not has_function_privilege('anon', 'public.cleanup_cron_job_run_details()', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.cleanup_cron_job_run_details()', 'EXECUTE')
		and not has_function_privilege('service_role', 'public.cleanup_cron_job_run_details()', 'EXECUTE'),
	'only the function owner can execute cron history cleanup'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-clean-cron-history'
			and schedule = '5 19 * * *'
			and command = 'select public.cleanup_cron_job_run_details()'
	),
	1::bigint,
	'exactly one daily 19:05 UTC cleanup job is scheduled'
);

delete from cron.job_run_details
where end_time is not null
	and start_time < now() - interval '14 days';

insert into cron.job_run_details (
	jobid,
	runid,
	job_pid,
	database,
	username,
	command,
	status,
	return_message,
	start_time,
	end_time
)
select
	null,
	-9000000000000 - item,
	null,
	'postgres',
	'postgres',
	'applemint-retention-test-old',
	'succeeded',
	'OK',
	now() - interval '15 days' - make_interval(secs => item),
	now() - interval '15 days' - make_interval(secs => item) + interval '1 second'
from generate_series(1, 10005) as item;

insert into cron.job_run_details (
	jobid, runid, database, username, command, status, start_time, end_time
)
values
	(null, -9000000010006, 'postgres', 'postgres', 'applemint-retention-test-recent', 'succeeded', now() - interval '13 days', now() - interval '13 days' + interval '1 second'),
	(null, -9000000010007, 'postgres', 'postgres', 'applemint-retention-test-running', 'running', now() - interval '30 days', null),
	(null, -9000000010008, 'postgres', 'postgres', 'applemint-retention-test-boundary', 'succeeded', now() - interval '14 days', now() - interval '14 days' + interval '1 second');

select is(
	public.cleanup_cron_job_run_details(),
	10000::bigint,
	'one cleanup call deletes at most 10000 completed expired rows'
);
select is(
	(
		select count(*)
		from cron.job_run_details
		where command = 'applemint-retention-test-old'
	),
	5::bigint,
	'rows beyond the batch limit remain for the next cleanup call'
);
select is(
	public.cleanup_cron_job_run_details(),
	5::bigint,
	'the next cleanup call deletes the remaining expired rows'
);
select is(
	public.cleanup_cron_job_run_details(),
	0::bigint,
	'cleanup is idempotent after all expired completed rows are deleted'
);
select is(
	(
		select count(*)
		from cron.job_run_details
		where command = 'applemint-retention-test-recent'
	),
	1::bigint,
	'completed rows within the 14 day retention window are preserved'
);
select is(
	(
		select count(*)
		from cron.job_run_details
		where command = 'applemint-retention-test-running'
	),
	1::bigint,
	'running rows are preserved regardless of age'
);
select is(
	(
		select count(*)
		from cron.job_run_details
		where command = 'applemint-retention-test-boundary'
	),
	1::bigint,
	'a completed row exactly 14 days old is preserved by the strict cutoff'
);
select is(
	(
		select count(*)
		from cron.job_run_details
		where command like 'applemint-retention-test-%'
	),
	3::bigint,
	'only recent, boundary, and running test rows remain'
);

select * from finish();
rollback;
