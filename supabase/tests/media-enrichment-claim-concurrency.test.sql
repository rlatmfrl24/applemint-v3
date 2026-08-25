-- Cross-session SKIP LOCKED media job claim contract.
select exists (
	select 1 from pg_extension where extname = 'dblink'
) as phase2_dblink_preexisting \gset

create extension if not exists dblink with schema extensions;

drop function if exists public.phase2_finish_media_job_with_delay(bigint);

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'phase2_claim_worker') then
		execute 'revoke select, update on public.threads from phase2_claim_worker';
		execute 'revoke select, update on public.thread_media_metadata from phase2_claim_worker';
		execute 'revoke select, update on public.media_enrichment_jobs from phase2_claim_worker';
		execute 'revoke execute on function public.normalize_normal_site_key(text) from phase2_claim_worker';
		execute 'revoke execute on function public.claim_media_enrichment_jobs(text, integer, integer) from phase2_claim_worker';
		execute 'drop role phase2_claim_worker';
	end if;
end;
$$;

delete from public.threads
where url like 'https://phase2-concurrency.test/%';

select replace(gen_random_uuid()::text, '-', '') as phase2_worker_password \gset

create role phase2_claim_worker
	login
	bypassrls
	password :'phase2_worker_password';

grant execute on function public.claim_media_enrichment_jobs(text, integer, integer)
	to phase2_claim_worker;
grant execute on function public.normalize_normal_site_key(text)
	to phase2_claim_worker;
grant select, update on public.threads to phase2_claim_worker;
grant select, update on public.thread_media_metadata to phase2_claim_worker;
grant select, update on public.media_enrichment_jobs to phase2_claim_worker;

create function public.phase2_finish_media_job_with_delay(p_thread_id bigint)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
	perform 1
	from public.media_enrichment_jobs as job
	where job.thread_id = p_thread_id
		and job.state = 'processing'
	for update;

	if not found then
		return false;
	end if;

	perform pg_catalog.pg_sleep(0.5);

	update public.thread_media_metadata
	set status = 'ready'
	where thread_id = p_thread_id;

	update public.media_enrichment_jobs
	set
		state = 'succeeded',
		lease_token = null,
		lease_expires_at = null,
		updated_at = clock_timestamp()
	where thread_id = p_thread_id
		and state = 'processing';

	return found;
end;
$$;

revoke all on function public.phase2_finish_media_job_with_delay(bigint)
	from public, anon, authenticated, service_role;
grant execute on function public.phase2_finish_media_job_with_delay(bigint)
	to phase2_claim_worker;

insert into public.threads (type, url, title, host, state)
values
	('youtube', 'https://phase2-concurrency.test/one', 'one', 'youtube.com', 'inbox'),
	('youtube', 'https://phase2-concurrency.test/two', 'two', 'youtube.com', 'inbox');
insert into public.thread_media_metadata (thread_id, provider)
select id, 'youtube'
from public.threads
where url like 'https://phase2-concurrency.test/%';
insert into public.media_enrichment_jobs (thread_id, provider, available_at)
select id, 'youtube', now() - interval '1 minute'
from public.threads
where url like 'https://phase2-concurrency.test/%';

select plan(23);

begin;
do $$
begin
	-- Keep every non-fixture queue row locked in this session so the dblink
	-- workers exercise the production claim function without mutating local data.
	perform 1
	from public.media_enrichment_jobs as job
	inner join public.threads as thread on thread.id = job.thread_id
	where job.provider = 'youtube'
		and thread.url not like 'https://phase2-concurrency.test/%'
	for update of job;
end;
$$;

select is(
	extensions.dblink_connect(
		'phase2_claim_1',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=phase2_claim_worker password=%s',
			:'phase2_worker_password'
		)
	),
	'OK',
	'first worker connection opens'
);
select is(
	extensions.dblink_connect(
		'phase2_claim_2',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=phase2_claim_worker password=%s',
			:'phase2_worker_password'
		)
	),
	'OK',
	'second worker connection opens'
);
select is(
	extensions.dblink_send_query(
		'phase2_claim_1',
		$query$
			with claimed as materialized (
				select * from public.claim_media_enrichment_jobs('youtube', 1, 60)
			),
			delay as materialized (
				select pg_sleep(0.5)
			)
			select
				claimed.thread_id,
				claimed.lease_token
			from claimed
			cross join delay
		$query$
	),
	1,
	'first worker claims while keeping its statement transaction open'
);
select pg_sleep(0.1);
select is(
	extensions.dblink_send_query(
		'phase2_claim_2',
		$$
			select thread_id, lease_token
			from public.claim_media_enrichment_jobs('youtube', 1, 60)
		$$
	),
	1,
	'second worker starts a competing claim'
);
select pg_sleep(0.1);
select is(
	extensions.dblink_is_busy('phase2_claim_2'),
	0,
	'SKIP LOCKED lets the second worker finish without waiting for the first'
);

create temporary table phase2_concurrent_claims (
	worker text not null,
	thread_id bigint not null,
	lease_token uuid not null
);
insert into phase2_concurrent_claims
select 'second', thread_id, lease_token
from extensions.dblink_get_result('phase2_claim_2')
	as response(thread_id bigint, lease_token uuid);
insert into phase2_concurrent_claims
select 'first', thread_id, lease_token
from extensions.dblink_get_result('phase2_claim_1')
	as response(thread_id bigint, lease_token uuid);

select is(
	(select count(*) from phase2_concurrent_claims),
	2::bigint,
	'both workers claim one job'
);
select is(
	(select count(distinct thread_id) from phase2_concurrent_claims),
	2::bigint,
	'competing workers never receive the same job'
);
select is(
	(select count(distinct lease_token) from phase2_concurrent_claims),
	2::bigint,
	'each claimed job has a unique lease token'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs
		where thread_id in (select thread_id from phase2_concurrent_claims)
			and state = 'processing'
			and attempt_count = 1
	),
	2::bigint,
	'both claims persist processing state and one attempt'
);
select is(
	extensions.dblink_disconnect('phase2_claim_1'),
	'OK',
	'first worker connection closes'
);
select is(
	extensions.dblink_disconnect('phase2_claim_2'),
	'OK',
	'second worker connection closes'
);

delete from public.threads
where url like 'https://phase2-concurrency.test/%';

select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		where job.thread_id in (select thread_id from phase2_concurrent_claims)
	),
	0::bigint,
	'thread deletion cascades through metadata to jobs'
);
commit;

insert into public.threads (type, url, title, host, state)
values (
	'youtube',
	'https://phase2-concurrency.test/trash-transition',
	'concurrent Trash transition',
	'youtube.com',
	'inbox'
);
insert into public.thread_media_metadata (thread_id, provider)
select id, 'youtube'
from public.threads
where url = 'https://phase2-concurrency.test/trash-transition';
insert into public.media_enrichment_jobs (
	thread_id,
	provider,
	state,
	attempt_count,
	lease_token,
	lease_expires_at
)
select
	id,
	'youtube',
	'processing',
	1,
	'00000000-0000-4000-8000-000000000902'::uuid,
	now() + interval '1 minute'
from public.threads
where url = 'https://phase2-concurrency.test/trash-transition';

select is(
	extensions.dblink_connect(
		'phase2_finish_worker',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=phase2_claim_worker password=%s',
			:'phase2_worker_password'
		)
	),
	'OK',
	'finishing worker connection opens'
);
select is(
	extensions.dblink_connect(
		'phase2_trash_transition',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=phase2_claim_worker password=%s',
			:'phase2_worker_password'
		)
	),
	'OK',
	'Trash transition connection opens'
);
select is(
	extensions.dblink_send_query(
		'phase2_finish_worker',
		format(
			'select public.phase2_finish_media_job_with_delay(%s)',
			(
				select id
				from public.threads
				where url = 'https://phase2-concurrency.test/trash-transition'
			)
		)
	),
	1,
	'worker starts while holding the job lock'
);
select pg_sleep(0.1);
select is(
	extensions.dblink_send_query(
		'phase2_trash_transition',
		format(
			'update public.threads set state = %L where id = %s returning id',
			'trash',
			(
				select id
				from public.threads
				where url = 'https://phase2-concurrency.test/trash-transition'
			)
		)
	),
	1,
	'Trash transition starts while completion owns the job lock'
);
select pg_sleep(0.1);
select is(
	extensions.dblink_is_busy('phase2_trash_transition'),
	1,
	'Trash transition waits on the job lock without taking the metadata lock'
);
select is(
	(
		select finished
		from extensions.dblink_get_result('phase2_finish_worker')
			as response(finished boolean)
	),
	true,
	'worker completes without a deadlock'
);
select is(
	(
		select id
		from extensions.dblink_get_result('phase2_trash_transition')
			as response(id bigint)
	),
	(
		select id
		from public.threads
		where url = 'https://phase2-concurrency.test/trash-transition'
	),
	'Trash transition completes after the worker releases the job lock'
);
select is(
	extensions.dblink_disconnect('phase2_finish_worker'),
	'OK',
	'finishing worker connection closes'
);
select is(
	extensions.dblink_disconnect('phase2_trash_transition'),
	'OK',
	'Trash transition connection closes'
);
select is(
	(
		select metadata.status
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url = 'https://phase2-concurrency.test/trash-transition'
	),
	'ready',
	'Trash preserves metadata completed before the job lock is released'
);
select is(
	(
		select job.state
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url = 'https://phase2-concurrency.test/trash-transition'
	),
	'succeeded',
	'Trash preserves the terminal job completed before lock recheck'
);

delete from public.threads
where url = 'https://phase2-concurrency.test/trash-transition';

select * from finish();

\if :phase2_dblink_preexisting
\else
drop extension dblink;
\endif
revoke execute on function public.phase2_finish_media_job_with_delay(bigint)
	from phase2_claim_worker;
revoke execute on function public.claim_media_enrichment_jobs(text, integer, integer)
	from phase2_claim_worker;
revoke execute on function public.normalize_normal_site_key(text)
	from phase2_claim_worker;
revoke select, update on public.threads from phase2_claim_worker;
revoke select, update on public.thread_media_metadata from phase2_claim_worker;
revoke select, update on public.media_enrichment_jobs from phase2_claim_worker;
drop function public.phase2_finish_media_job_with_delay(bigint);
drop role phase2_claim_worker;
