begin;

select plan(16);

select ok(
	has_table_privilege('service_role', 'public."crawl-history"', 'SELECT,INSERT'),
	'service role retains the crawl history privileges required for ingest'
);
select ok(
	not has_table_privilege('service_role', 'public."crawl-history"', 'UPDATE')
		and not has_table_privilege('service_role', 'public."crawl-history"', 'DELETE')
		and not has_table_privilege('service_role', 'public."crawl-history"', 'TRUNCATE'),
	'service role cannot mutate or delete permanent crawl history'
);
select ok(
	has_sequence_privilege('service_role', 'public."crawl-history_id_seq"', 'USAGE,SELECT'),
	'service role retains the sequence privileges required for ingest'
);
select ok(
	not has_sequence_privilege('service_role', 'public."crawl-history_id_seq"', 'UPDATE'),
	'service role cannot advance the crawl history sequence directly'
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
	(select count(*) from public."new-threads" where url = 'https://retention.test/permanent'),
	1::bigint,
	'first ingest creates one visible thread'
);

delete from public."new-threads" where url = 'https://retention.test/permanent';

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
	(select count(*) from public."new-threads" where url = 'https://retention.test/permanent'),
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

select * from finish();
rollback;
