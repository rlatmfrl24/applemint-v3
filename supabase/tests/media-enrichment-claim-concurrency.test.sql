-- Cross-session SKIP LOCKED media job claim contract.
create extension if not exists dblink with schema extensions;

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'phase2_claim_worker') then
		execute 'revoke execute on function public.claim_media_enrichment_jobs(text, integer, integer) from phase2_claim_worker';
		execute 'revoke select on public.threads from phase2_claim_worker';
		execute 'revoke select, update on public.media_enrichment_jobs from phase2_claim_worker';
		execute 'drop role phase2_claim_worker';
	end if;
end;
$$;

select replace(gen_random_uuid()::text, '-', '') as phase2_worker_password \gset

create role phase2_claim_worker
	login
	bypassrls
	password :'phase2_worker_password';

grant execute on function public.claim_media_enrichment_jobs(text, integer, integer)
	to phase2_claim_worker;
grant select on public.threads to phase2_claim_worker;
grant select, update on public.media_enrichment_jobs to phase2_claim_worker;

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

select plan(12);

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

select * from finish();

drop extension dblink;
revoke execute on function public.claim_media_enrichment_jobs(text, integer, integer)
	from phase2_claim_worker;
revoke select on public.threads from phase2_claim_worker;
revoke select, update on public.media_enrichment_jobs from phase2_claim_worker;
drop role phase2_claim_worker;
