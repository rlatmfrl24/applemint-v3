begin;

select plan(9);

select ok(
	to_regprocedure('public.list_thread_page(text,integer,timestamp with time zone,bigint,text,text)') is null
		and to_regprocedure('public.list_thread_page(text,integer,timestamp with time zone,bigint,text)') is not null,
	'thread pagination no longer exposes the IssueLink category argument'
);

select ok(
	to_regprocedure('public.get_new_threads_stats(text,text)') is null
		and to_regprocedure('public.get_new_threads_stats(text)') is not null,
	'thread statistics no longer expose the IssueLink category argument'
);

set local role service_role;
select throws_ok(
	$$select public.ingest_crawl_items('issuelink', '[{"url":"https://legacy.test/issue"}]'::jsonb)$$,
	'22023',
	'Unsupported crawl source.',
	'new IssueLink crawl items are rejected'
);
select throws_ok(
	$$select public.begin_crawl_run('issuelink', '40000000-0000-4000-8000-000000000001'::uuid, 300)$$,
	'22023',
	'Unsupported crawl source.',
	'new IssueLink crawl runs are rejected'
);
reset role;

insert into public."crawl-history" (url, crawl_source, host)
values ('https://legacy.test/issue-history', 'issuelink', 'legacy.test');

select is(
	(
		select count(*)
		from public."crawl-history"
		where crawl_source = 'issuelink' and url = 'https://legacy.test/issue-history'
	),
	1::bigint,
	'legacy IssueLink crawl history remains preservable'
);

select is(
	(
		select pg_get_constraintdef(oid)
		from pg_constraint
		where conrelid = 'public.crawl_runs'::regclass and conname = 'crawl_runs_source_check'
	),
	'CHECK ((source = ANY (ARRAY[''arcalive''::text, ''battlepage''::text, ''insagirl''::text])))',
	'crawl runs accept only the three active sources'
);

select is(
	(
		select pg_get_constraintdef(oid)
		from pg_constraint
		where conrelid = 'public.crawl_alert_incidents'::regclass
			and conname = 'crawl_alert_incidents_source_check'
	),
	'CHECK ((source = ANY (ARRAY[''arcalive''::text, ''battlepage''::text, ''insagirl''::text])))',
	'crawl alert incidents accept only the three active sources'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	jsonb_array_length(public.get_crawl_runs_dashboard(20, 20) -> 'sources'),
	3,
	'crawl dashboard returns exactly three source summaries'
);
select ok(
	not jsonb_path_exists(
		public.get_crawl_runs_dashboard(20, 20),
		'$.sources[*] ? (@.source == "issuelink")'
	),
	'crawl dashboard does not expose IssueLink'
);
reset role;

select * from finish();
rollback;
