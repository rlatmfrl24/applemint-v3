-- Cross-session ingest serialization contract.
select exists (
	select 1 from pg_extension where extname = 'dblink'
) as p0_dblink_preexisting \gset

create extension if not exists dblink with schema extensions;

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'p0_concurrent_ingest_login') then
		execute 'revoke execute on function public.ingest_crawl_items(text, jsonb) from p0_concurrent_ingest_login';
		execute 'revoke execute on function public.normalize_normal_site_key(text) from p0_concurrent_ingest_login';
		execute 'revoke select, insert, delete on public."crawl-history", public.threads from p0_concurrent_ingest_login';
		execute 'revoke select, insert, delete on public.thread_media_metadata, public.media_enrichment_jobs from p0_concurrent_ingest_login';
		execute 'revoke select on public.media_worker_runtime_settings from p0_concurrent_ingest_login';
		execute 'revoke usage, select on sequence public."crawl-history_id_seq", public.threads_id_seq from p0_concurrent_ingest_login';
		execute 'drop role p0_concurrent_ingest_login';
	end if;
end;
$$;

delete from public.threads where url = 'https://p0.test/concurrent-ingest';
delete from public."crawl-history"
where crawl_source = 'arcalive' and url = 'https://p0.test/concurrent-ingest';

select replace(gen_random_uuid()::text, '-', '') as p0_test_password \gset

create role p0_concurrent_ingest_login
	login
	bypassrls
	password :'p0_test_password';

grant execute on function public.ingest_crawl_items(text, jsonb)
	to p0_concurrent_ingest_login;
grant execute on function public.normalize_normal_site_key(text)
	to p0_concurrent_ingest_login;
grant select, insert, delete on public."crawl-history", public.threads
	to p0_concurrent_ingest_login;
grant select, insert, delete on public.thread_media_metadata, public.media_enrichment_jobs
	to p0_concurrent_ingest_login;
grant select on public.media_worker_runtime_settings
	to p0_concurrent_ingest_login;
grant usage, select on sequence
	public."crawl-history_id_seq",
	public.threads_id_seq
	to p0_concurrent_ingest_login;

select plan(20);

select is(
	extensions.dblink_connect(
		'p0_ingest_1',
		format(
			'host=%s port=5432 dbname=postgres user=p0_concurrent_ingest_login password=%s',
			host(inet_server_addr()),
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
			'host=%s port=5432 dbname=postgres user=p0_concurrent_ingest_login password=%s',
			host(inet_server_addr()),
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

select * from extensions.dblink_get_result('p0_ingest_1') as response(result jsonb);
select * from extensions.dblink_get_result('p0_ingest_2') as response(result jsonb);
truncate p0_concurrent_results;
select extensions.dblink_send_query('p0_ingest_1', $query$
	with delay as materialized (select pg_sleep(0.25))
	select public.ingest_crawl_items('issuelink', '[{"url":"https://p0.test/issuelink-concurrent?writer=1","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/p0-concurrent"}]') from delay
$query$);
select extensions.dblink_send_query('p0_ingest_2', $query$
	with delay as materialized (select pg_sleep(0.25))
	select public.ingest_crawl_items('issuelink', '[{"url":"https://p0.test/issuelink-concurrent?writer=2","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/p0-concurrent"}]') from delay
$query$);
insert into p0_concurrent_results select result from extensions.dblink_get_result('p0_ingest_1') as response(result jsonb);
insert into p0_concurrent_results select result from extensions.dblink_get_result('p0_ingest_2') as response(result jsonb);
select is(
	(select sum((result ->> 'insertedCount')::bigint) from p0_concurrent_results),
	1::numeric, 'concurrent query variants claim one collection identity'
);
select is(
	(select count(*) from public.threads where url like 'https://p0.test/issuelink-concurrent%'),
	1::bigint, 'concurrent query variants create one original thread'
);
select is(
	(select count(*) from public."crawl-history" where crawl_source = 'issuelink' and url = 'https://www.issuelink.co.kr/community/go/fmkorea/p0-concurrent'),
	1::bigint, 'concurrent query variants retain one stable history row'
);

select * from extensions.dblink_get_result('p0_ingest_1') as response(result jsonb);
select * from extensions.dblink_get_result('p0_ingest_2') as response(result jsonb);
truncate p0_concurrent_results;
select extensions.dblink_send_query('p0_ingest_1', $query$
	with delay as materialized (select pg_sleep(0.25))
	select public.ingest_crawl_items('issuelink', '[{"url":"https://p0.test/issuelink-mixed"}]') from delay
$query$);
select extensions.dblink_send_query('p0_ingest_2', $query$
	with delay as materialized (select pg_sleep(0.25))
	select public.ingest_crawl_items('issuelink', '[{"url":"https://p0.test/issuelink-mixed","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/p0-mixed"}]') from delay
$query$);
insert into p0_concurrent_results select result from extensions.dblink_get_result('p0_ingest_1') as response(result jsonb);
insert into p0_concurrent_results select result from extensions.dblink_get_result('p0_ingest_2') as response(result jsonb);
select is(
	(select sum((result ->> 'insertedCount')::bigint) from p0_concurrent_results),
	1::numeric, 'old and new concurrent payloads claim one original'
);
select is(
	(select count(*) from public.threads where url = 'https://p0.test/issuelink-mixed'),
	1::bigint, 'old and new concurrent payloads create one thread'
);
select is(
	(select count(*) from public."crawl-history" where crawl_source = 'issuelink' and url = 'https://p0.test/issuelink-mixed'),
	1::bigint, 'old and new concurrent payloads retain one original claim'
);

-- The existing BEFORE INSERT source lifecycle lock must protect mixed batch lock order too.
create function public.p0_delay_history_claim()
returns trigger language plpgsql set search_path = '' as $$
begin
	if new.url = 'https://p0.test/issuelink-order-first' then perform pg_catalog.pg_sleep(0.3); end if;
	return new;
end;
$$;
create trigger p0_delay_history_claim after insert on public."crawl-history"
for each row execute function public.p0_delay_history_claim();
select * from extensions.dblink_get_result('p0_ingest_1') as response(result jsonb);
select * from extensions.dblink_get_result('p0_ingest_2') as response(result jsonb);
truncate p0_concurrent_results;
select extensions.dblink_send_query('p0_ingest_1', $query$
	select public.ingest_crawl_items('issuelink', '[{"url":"https://p0.test/issuelink-order-first"},{"url":"https://p0.test/issuelink-order-second","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/p0-mixed-order"}]')
$query$);
select extensions.dblink_send_query('p0_ingest_2', $query$
	with delay as materialized (select pg_sleep(0.05))
	select public.ingest_crawl_items('issuelink', '[{"url":"https://p0.test/issuelink-order-first","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/p0-mixed-order"}]') from delay
$query$);
insert into p0_concurrent_results select result from extensions.dblink_get_result('p0_ingest_1') as response(result jsonb);
insert into p0_concurrent_results select result from extensions.dblink_get_result('p0_ingest_2') as response(result jsonb);
select is((select count(*) from p0_concurrent_results), 2::bigint,
	'mixed legacy and alias batches finish without a lock-order deadlock');
select is((select count(*) from public.threads where url = 'https://p0.test/issuelink-order-first'), 1::bigint,
	'mixed legacy and alias batches preserve original uniqueness');
select is((select count(*) from public."crawl-history" where crawl_source = 'issuelink' and url = 'https://www.issuelink.co.kr/community/go/fmkorea/p0-mixed-order'), 1::bigint,
	'mixed legacy and alias batches preserve collection identity uniqueness');
drop trigger p0_delay_history_claim on public."crawl-history";
drop function public.p0_delay_history_claim();

delete from public.threads where url like 'https://p0.test/issuelink-%';
delete from public."crawl-history" where crawl_source = 'issuelink' and (
	url like 'https://p0.test/issuelink-%'
	or url in ('https://www.issuelink.co.kr/community/go/fmkorea/p0-concurrent', 'https://www.issuelink.co.kr/community/go/fmkorea/p0-mixed', 'https://www.issuelink.co.kr/community/go/fmkorea/p0-mixed-order')
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

\if :p0_dblink_preexisting
\else
drop extension dblink;
\endif
revoke execute on function public.ingest_crawl_items(text, jsonb)
	from p0_concurrent_ingest_login;
revoke execute on function public.normalize_normal_site_key(text)
	from p0_concurrent_ingest_login;
revoke select, insert, delete on public."crawl-history", public.threads
	from p0_concurrent_ingest_login;
revoke select, insert, delete on public.thread_media_metadata, public.media_enrichment_jobs
	from p0_concurrent_ingest_login;
revoke select on public.media_worker_runtime_settings
	from p0_concurrent_ingest_login;
revoke usage, select on sequence
	public."crawl-history_id_seq",
	public.threads_id_seq
	from p0_concurrent_ingest_login;
drop role p0_concurrent_ingest_login;
