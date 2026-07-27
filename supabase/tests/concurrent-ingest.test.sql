-- Cross-session ingest serialization contract.
create extension if not exists dblink with schema extensions;

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'p0_concurrent_ingest_login') then
		execute 'revoke execute on function public.ingest_crawl_items(text, jsonb) from p0_concurrent_ingest_login';
		execute 'revoke select, insert, delete on public."crawl-history", public.threads from p0_concurrent_ingest_login';
		execute 'revoke select, insert, delete on public.thread_media_metadata, public.media_enrichment_jobs from p0_concurrent_ingest_login';
		execute 'revoke usage, select on sequence public."crawl-history_id_seq", public.threads_id_seq from p0_concurrent_ingest_login';
		execute 'drop role p0_concurrent_ingest_login';
	end if;
end;
$$;

select replace(gen_random_uuid()::text, '-', '') as p0_test_password \gset

create role p0_concurrent_ingest_login
	login
	bypassrls
	password :'p0_test_password';

grant execute on function public.ingest_crawl_items(text, jsonb)
	to p0_concurrent_ingest_login;
grant select, insert, delete on public."crawl-history", public.threads
	to p0_concurrent_ingest_login;
grant select, insert, delete on public.thread_media_metadata, public.media_enrichment_jobs
	to p0_concurrent_ingest_login;
grant usage, select on sequence
	public."crawl-history_id_seq",
	public.threads_id_seq
	to p0_concurrent_ingest_login;

select plan(11);

select is(
	extensions.dblink_connect(
		'p0_ingest_1',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=p0_concurrent_ingest_login password=%s',
			:'p0_test_password'
		)
	),
	'OK',
	'first concurrent test connection opens'
);
select is(
	extensions.dblink_connect(
		'p0_ingest_2',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=p0_concurrent_ingest_login password=%s',
			:'p0_test_password'
		)
	),
	'OK',
	'second concurrent test connection opens'
);

select is(
	extensions.dblink_send_query(
		'p0_ingest_1',
		$query$
			with delay as materialized (select pg_sleep(0.25))
			select public.ingest_crawl_items(
				'arcalive',
				'[{"url":"https://p0.test/concurrent-ingest","title":"first","type":"normal"}]'::jsonb
			)
			from delay
		$query$
	),
	1,
	'first concurrent ingest starts asynchronously'
);
select is(
	extensions.dblink_send_query(
		'p0_ingest_2',
		$query$
			with delay as materialized (select pg_sleep(0.25))
			select public.ingest_crawl_items(
				'arcalive',
				'[{"url":"https://p0.test/concurrent-ingest","title":"second","type":"normal"}]'::jsonb
			)
			from delay
		$query$
	),
	1,
	'second concurrent ingest starts asynchronously'
);

create temporary table p0_concurrent_results (result jsonb not null);

insert into p0_concurrent_results (result)
select result
from extensions.dblink_get_result('p0_ingest_1') as response(result jsonb);

insert into p0_concurrent_results (result)
select result
from extensions.dblink_get_result('p0_ingest_2') as response(result jsonb);

select is(
	(select count(*) from p0_concurrent_results),
	2::bigint,
	'both concurrent ingest calls return'
);
select is(
	(select sum((result ->> 'insertedCount')::bigint) from p0_concurrent_results),
	1::numeric,
	'exactly one concurrent call inserts the URL'
);
select is(
	(select sum((result ->> 'skippedCount')::bigint) from p0_concurrent_results),
	1::numeric,
	'the competing concurrent call skips the claimed URL'
);
select is(
	(
		select count(*)
		from public."crawl-history"
		where crawl_source = 'arcalive' and url = 'https://p0.test/concurrent-ingest'
	),
	1::bigint,
	'concurrent ingest creates one history row'
);
select is(
	(select count(*) from public.threads where state = 'inbox' and url = 'https://p0.test/concurrent-ingest'),
	1::bigint,
	'concurrent ingest creates one new thread'
);

delete from public.threads where url = 'https://p0.test/concurrent-ingest';
delete from public."crawl-history"
where crawl_source = 'arcalive' and url = 'https://p0.test/concurrent-ingest';

select is(
	extensions.dblink_disconnect('p0_ingest_1'),
	'OK',
	'first concurrent test connection closes'
);
select is(
	extensions.dblink_disconnect('p0_ingest_2'),
	'OK',
	'second concurrent test connection closes'
);

select * from finish();

drop extension dblink;
revoke execute on function public.ingest_crawl_items(text, jsonb)
	from p0_concurrent_ingest_login;
revoke select, insert, delete on public."crawl-history", public.threads
	from p0_concurrent_ingest_login;
revoke select, insert, delete on public.thread_media_metadata, public.media_enrichment_jobs
	from p0_concurrent_ingest_login;
revoke usage, select on sequence
	public."crawl-history_id_seq",
	public.threads_id_seq
	from p0_concurrent_ingest_login;
drop role p0_concurrent_ingest_login;
