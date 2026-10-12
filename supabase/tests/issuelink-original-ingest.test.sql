begin;
select plan(22);

set local role service_role;
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/first?ref=1","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-first","title":"original","host":"https://www.fmkorea.com"}]') ->> 'insertedCount')::integer,
	1, 'original ingest creates a thread'
);
reset role;
select is(
	(select count(*) from public.threads where url = 'https://www.fmkorea.com/applemint-original-test/first?ref=1'),
	1::bigint, 'thread stores the original URL and its query'
);
select is(
	(select count(*) from public."crawl-history" where crawl_source = 'issuelink' and url = 'https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-first'),
	1::bigint, 'history stores the stable collection identity'
);
set local role service_role;
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/first?ref=2","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-first"}]') ->> 'insertedCount')::integer,
	0, 'changed original query does not recrawl the same item'
);
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/first?ref=1"}]') ->> 'insertedCount')::integer,
	0, 'old payload cannot recrawl an original captured with historyUrl'
);
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/first?ref=1","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-alias"}]') ->> 'insertedCount')::integer,
	0, 'a different collection alias cannot duplicate an original'
);
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/first?ref=3","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-alias"}]') ->> 'insertedCount')::integer,
	0, 'a known original alias stays known when its query changes'
);
with result as materialized (
	select public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/shared","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-shared-a"},{"url":"https://www.fmkorea.com/applemint-original-test/shared","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-shared-b"}]') as value
)
select is((select (value ->> 'insertedCount') || ':' || (value ->> 'skippedCount') from result),
	'1:1', 'two aliases in a batch create one original and skip one duplicate');
reset role;
select is(
	(select count(*) from public."crawl-history" where crawl_source = 'issuelink' and url in ('https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-shared-a', 'https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-shared-b')),
	2::bigint, 'both collection aliases are permanently recorded'
);
set local role service_role;
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/shared?ref=2","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-shared-b"}]') ->> 'insertedCount')::integer,
	0, 'the second shared alias remains known after a query change'
);
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/batch?ref=1","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-batch"},{"url":"https://www.fmkorea.com/applemint-original-test/batch?ref=2","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-batch"}]') ->> 'insertedCount')::integer,
	1, 'a duplicate history identity in one batch creates one thread'
);
reset role;

insert into public."crawl-history" (crawl_source, url)
values ('issuelink', 'https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-legacy'),
	('issuelink', 'https://www.fmkorea.com/applemint-original-test/legacy-original');
insert into public.threads (url, title, type, state)
values ('https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-legacy', 'legacy', 'normal', 'saved');
set local role service_role;
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/legacy","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-legacy"}]') ->> 'insertedCount')::integer,
	0, 'existing IssueLink history prevents a duplicate original thread'
);
select is(
	(public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/legacy-original","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-legacy-original"}]') ->> 'insertedCount')::integer,
	0, 'existing original history also prevents a duplicate thread'
);
select is(
	(public.ingest_crawl_items('arcalive', '[{"url":"https://arca.live/b/applemint-original-test/1"}]') ->> 'insertedCount')::integer,
	1, 'payload without historyUrl remains compatible'
);
select throws_ok(
	$$select public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/invalid","historyUrl":123}]')$$,
	'22023', null, 'non-string historyUrl is rejected'
);
select throws_ok(
	$$select public.ingest_crawl_items('dogdrip', '[]')$$,
	'22023', null, 'retired sources remain rejected'
);
reset role;
select ok(
	not has_function_privilege('anon', 'public.ingest_crawl_items(text,jsonb)', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.ingest_crawl_items(text,jsonb)', 'EXECUTE'),
	'ingest remains server-only'
);
alter table public.threads add constraint issuelink_original_test_failure
	check (url <> 'https://www.fmkorea.com/applemint-original-test/rollback');
set local role service_role;
select throws_ok(
	$$select public.ingest_crawl_items('issuelink', '[{"url":"https://www.fmkorea.com/applemint-original-test/rollback","historyUrl":"https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-rollback","type":"invalid"}]')$$,
	'23514', null, 'failed thread insertion rolls back the history claim'
);
reset role;
select is(
	(select count(*) from public."crawl-history" where url = 'https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-rollback'),
	0::bigint, 'rollback leaves no consumed history identity'
);
select is(
	(select count(*) from public.threads where url = 'https://www.issuelink.co.kr/community/go/fmkorea/applemint-test-legacy' and title = 'legacy' and state = 'saved'),
	1::bigint, 'existing saved thread remains unchanged'
);
select is(
	(select count(*) from public.threads where url like 'https://www.fmkorea.com/applemint-original-test/first%'),
	1::bigint, 'repeated collection keeps one original thread'
);
select is(
	(select count(*) from public."crawl-history" where crawl_source = 'arcalive' and url = 'https://arca.live/b/applemint-original-test/1'),
	1::bigint, 'old payload retains URL-based history'
);

select * from finish();
rollback;
