-- Canonical thread state, pagination, and atomicity contract.
begin;

select plan(63);

select has_table('public', 'threads', 'threads is the canonical table');
select has_index('public', 'threads', 'idx_threads_state_changed_at_id', 'state cursor index exists');
select has_index(
	'public',
	'threads',
	'idx_threads_state_type_changed_at_id',
	'state and type cursor index exists'
);
select has_index(
	'public',
	'threads',
	'idx_threads_state_type_site_changed_at_id',
	'state, type, and canonical site cursor index exists'
);
select ok(
	(select relrowsecurity from pg_class where oid = 'public.threads'::regclass),
	'RLS is enabled on threads'
);
select policies_are(
	'public',
	'threads',
	array['Applemint owner can read threads'],
	'threads exposes only the owner read policy'
);
insert into public.threads (
	type, url, title, description, host, tag, state, created_at, captured_at, state_changed_at
)
values (
	'p9',
	'https://p9.test/thread',
	'canonical thread',
	'thread cleanup contract',
	'p9.test',
	array['cleanup', 'state'],
	'inbox',
	'2026-01-01 00:00:00+00',
	'2025-12-31 23:59:00+00',
	'2026-01-02 00:00:00+00'
);

create temporary table p9_state as
select id, created_at, captured_at, state_changed_at
from public.threads
where url = 'https://p9.test/thread';
alter table p9_state add primary key (id);
grant select on p9_state to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(select id from p9_state),
		'inbox',
		'saved'
	),
	'canonical transition moves inbox to saved'
);
reset role;

select is(
	(select id from public.threads where url = 'https://p9.test/thread'),
	(select id from p9_state),
	'state transition preserves the thread ID'
);
select is(
	(select created_at from public.threads where url = 'https://p9.test/thread'),
	(select created_at from p9_state),
	'state transition preserves created_at'
);
select is(
	(select captured_at from public.threads where url = 'https://p9.test/thread'),
	(select captured_at from p9_state),
	'state transition preserves captured_at'
);
select ok(
	(select state_changed_at from public.threads where url = 'https://p9.test/thread') >
		(select state_changed_at from p9_state),
	'state transition advances state_changed_at'
);

update p9_state
set state_changed_at = (
	select state_changed_at from public.threads where url = 'https://p9.test/thread'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(select id from p9_state),
		'inbox',
		'saved'
	),
	'idempotent retry succeeds when the destination already matches'
);
reset role;
select is(
	(select state_changed_at from public.threads where url = 'https://p9.test/thread'),
	(select state_changed_at from p9_state),
	'idempotent retry does not change state_changed_at'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select throws_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(select id from p9_state),
		'inbox',
		'trash'
	),
	'40001',
	format('Thread %s is in state saved instead of expected state inbox.', (select id from p9_state)),
	'expected-state conflict is distinguishable'
);
select throws_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(select id from p9_state),
		'saved',
		'inbox'
	),
	'22023',
	'Unsupported thread transition: saved -> inbox',
	'unsupported transition is rejected'
);
select is(
	(select count(*) from public.list_threads_page('saved', 24, null, null, 'p9')),
	1::bigint,
	'canonical list RPC filters by state and type'
);
select is(
	(select max(total_count) from public.get_thread_stats('saved', 'p9')),
	1::bigint,
	'canonical stats RPC reports the filtered total'
);
reset role;

create temporary table p9_bulk_baseline as
select count(*)::bigint as inbox_count
from public.threads
where state = 'inbox';
grant select on p9_bulk_baseline to authenticated;

insert into public.threads (type, url, state)
values
	('p9-bulk', 'https://p9.test/bulk-1', 'inbox'),
	('p9-bulk', 'https://p9.test/bulk-2', 'inbox');

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	public.bulk_move_inbox_to_trash(),
	(select inbox_count + 2 from p9_bulk_baseline),
	'bulk transition returns its moved count'
);
reset role;
select is(
	(select count(*) from public.threads where type = 'p9-bulk' and state = 'inbox'),
	0::bigint,
	'bulk transition leaves no matching inbox rows'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select public.transition_thread_state((select id from p9_state), 'saved', 'trash');
reset role;
update public.threads
set state_changed_at = now() - interval '8 days'
where url = 'https://p9.test/thread';
set local role service_role;
select lives_ok('select public.clean_trash()', 'clean_trash runs for service_role');
reset role;
select is(
	(select count(*) from public.threads where url = 'https://p9.test/thread'),
	0::bigint,
	'clean_trash uses trash state_changed_at retention'
);

set local role service_role;
select is(
	public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://p9.test/ingest","title":"ingested","type":"normal"}]'::jsonb
	),
	'{"insertedCount": 1, "skippedCount": 0}'::jsonb,
	'ingest keeps its response contract'
);
reset role;
select is(
	(select state from public.threads where url = 'https://p9.test/ingest'),
	'inbox',
	'ingest writes to the canonical inbox'
);

set local role service_role;
select is(
	public.ingest_crawl_items(
		'insagirl',
		'[
			{"url":"https://www.youtube.com/watch?v=p9","title":"YouTube","type":"youtube"},
			{"url":"https://imgur.com/a/p9","title":"Imgur","type":"imgur"}
		]'::jsonb
	),
	'{"insertedCount": 2, "skippedCount": 0}'::jsonb,
	'ingest preserves active provider types'
);
reset role;
select is(
	(
		select array_agg(type order by type)
		from public.threads
		where url in ('https://www.youtube.com/watch?v=p9', 'https://imgur.com/a/p9')
	),
	array['imgur', 'youtube']::text[],
	'ingested provider rows retain youtube and imgur types'
);

set local role service_role;
select throws_ok(
	$$select public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://p9.test/retired-media","type":"media"}]'::jsonb
	)$$,
	'23514',
	'Retired thread types cannot be ingested.',
	'ingest rejects the retired media type'
);
select throws_ok(
	$$select public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://p9.test/retired-issuelink","type":"issuelink"}]'::jsonb
	)$$,
	'23514',
	'Retired thread types cannot be ingested.',
	'ingest rejects the retired IssueLink type'
);
reset role;
select is(
	(
		select count(*)
		from public."crawl-history"
		where url in ('https://p9.test/retired-media', 'https://p9.test/retired-issuelink')
	),
	0::bigint,
	'rejected provider batches leave no crawl history'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	(select count(*) from public.list_threads_page('inbox', 24, null, null, 'youtube')),
	1::bigint,
	'canonical list RPC filters YouTube threads'
);
select is(
	(select max(total_count) from public.get_thread_stats('inbox', 'youtube')),
	1::bigint,
	'canonical stats RPC filters YouTube threads'
);
select is(
	(select count(*) from public.list_threads_page('inbox', 24, null, null, 'imgur')),
	1::bigint,
	'canonical list RPC filters Imgur threads'
);
select is(
	(select max(total_count) from public.get_thread_stats('inbox', 'imgur')),
	1::bigint,
	'canonical stats RPC filters Imgur threads'
);
reset role;

insert into public.threads (
	type, url, state, created_at, captured_at, state_changed_at
)
values
	(
		'legacy-youtube',
		'https://www.youtube.com/watch?v=backfill-inbox',
		'inbox',
		'2026-02-01 00:00:00+00',
		'2026-01-31 23:00:00+00',
		'2026-02-02 00:00:00+00'
	),
	(
		'legacy-youtube-playlist',
		'https://music.youtube.com/playlist?list=backfill-saved',
		'saved',
		'2026-02-03 00:00:00+00',
		'2026-02-02 23:00:00+00',
		'2026-02-04 00:00:00+00'
	),
	(
		'legacy-imgur',
		'https://imgur.com/a/backfill-trash',
		'trash',
		'2026-02-05 00:00:00+00',
		'2026-02-04 23:00:00+00',
		'2026-02-06 00:00:00+00'
	),
	(
		'legacy-evil',
		'https://youtube.com.evil.example/watch?v=backfill',
		'inbox',
		'2026-02-07 00:00:00+00',
		'2026-02-06 23:00:00+00',
		'2026-02-08 00:00:00+00'
	),
	(
		'legacy-query',
		'https://example.com/?next=https://imgur.com/a/backfill',
		'saved',
		'2026-02-09 00:00:00+00',
		'2026-02-08 23:00:00+00',
		'2026-02-10 00:00:00+00'
	);

insert into public."crawl-history" (url, crawl_source, host, created_at)
select url, 'insagirl', 'backfill.test', '2026-01-01 00:00:00+00'
from public.threads
where type like 'legacy-%';

create temporary table p9_media_backfill_snapshot as
select id, type, url, state, created_at, captured_at, state_changed_at
from public.threads
where type like 'legacy-%';
alter table p9_media_backfill_snapshot add primary key (id);

create temporary table p9_media_history_snapshot as
select id, url, crawl_source, host, created_at
from public."crawl-history"
where url in (select url from p9_media_backfill_snapshot);
alter table p9_media_history_snapshot add primary key (id);

create function pg_temp.backfill_media_thread_types()
returns bigint
language sql
set search_path = ''
as $$
	with classified as materialized (
		select
			id,
			case
				when btrim(url) ~* '^https?://(youtube\.com|www\.youtube\.com|m\.youtube\.com|music\.youtube\.com|youtu\.be)(:[0-9]+)?/[^?#]+([?#].*)?$'
					then 'youtube'
				when btrim(url) ~* '^https?://(imgur\.com|www\.imgur\.com|i\.imgur\.com)(:[0-9]+)?/[^?#]+([?#].*)?$'
					then 'imgur'
				else null
			end as desired_type
		from public.threads
	),
	updated as (
		update public.threads as thread
		set type = classified.desired_type
		from classified
		where thread.id = classified.id
			and classified.desired_type is not null
			and thread.type is distinct from classified.desired_type
		returning thread.id
	)
	select count(*) from updated;
$$;

select is(
	pg_temp.backfill_media_thread_types(),
	3::bigint,
	'media backfill updates only exact provider URLs'
);
select ok(
	(select type = 'youtube' from public.threads where url = 'https://www.youtube.com/watch?v=backfill-inbox')
		and (
			select type = 'youtube'
			from public.threads
			where url = 'https://music.youtube.com/playlist?list=backfill-saved'
		)
		and (select type = 'imgur' from public.threads where url = 'https://imgur.com/a/backfill-trash')
		and (
			select type = 'legacy-evil'
			from public.threads
			where url = 'https://youtube.com.evil.example/watch?v=backfill'
		)
		and (
			select type = 'legacy-query'
			from public.threads
			where url = 'https://example.com/?next=https://imgur.com/a/backfill'
		),
	'media backfill maps providers and rejects hostname, query, and fragment impostors'
);
select ok(
	not exists (
		select 1
		from public.threads as thread
		inner join p9_media_backfill_snapshot as snapshot using (id)
		where thread.state is distinct from snapshot.state
	),
	'media backfill preserves every thread state'
);
select ok(
	not exists (
		select 1
		from public.threads as thread
		inner join p9_media_backfill_snapshot as snapshot using (id)
		where thread.url is distinct from snapshot.url
			or thread.created_at is distinct from snapshot.created_at
			or thread.captured_at is distinct from snapshot.captured_at
			or thread.state_changed_at is distinct from snapshot.state_changed_at
	),
	'media backfill preserves IDs, URLs, and thread timestamps'
);
select ok(
	not exists (
		(
			select id, url, crawl_source, host, created_at
			from public."crawl-history"
			where url in (select url from p9_media_backfill_snapshot)
			except
			select id, url, crawl_source, host, created_at
			from p9_media_history_snapshot
		)
		union all
		(
			select id, url, crawl_source, host, created_at
			from p9_media_history_snapshot
			except
			select id, url, crawl_source, host, created_at
			from public."crawl-history"
			where url in (select url from p9_media_backfill_snapshot)
		)
	),
	'media backfill leaves crawl history unchanged'
);
select is(
	pg_temp.backfill_media_thread_types(),
	0::bigint,
	'media backfill is idempotent'
);

create function pg_temp.reject_thread_update()
returns trigger
language plpgsql
as $$
begin
	raise exception 'reject thread update';
end;
$$;

create trigger reject_thread_update
before update on public.threads
for each row
when (old.url = 'https://thread.test/rollback-move')
execute function pg_temp.reject_thread_update();

insert into public.threads (type, url, state)
values ('rollback', 'https://thread.test/rollback-move', 'inbox');

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select throws_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(select id from public.threads where url = 'https://thread.test/rollback-move'),
		'inbox',
		'saved'
	),
	'reject thread update',
	'failed transition rolls back the state update'
);
reset role;
select is(
	(select state from public.threads where url = 'https://thread.test/rollback-move'),
	'inbox',
	'failed transition leaves the source state intact'
);
drop trigger reject_thread_update on public.threads;
delete from public.threads where url = 'https://thread.test/rollback-move';

create function pg_temp.reject_thread_insert()
returns trigger
language plpgsql
as $$
begin
	if new.url = 'https://thread.test/ingest-reject' then
		raise exception 'reject thread insert';
	end if;
	return new;
end;
$$;

create trigger reject_thread_insert
before insert on public.threads
for each row execute function pg_temp.reject_thread_insert();

set local role service_role;
select throws_ok(
	$$
		select public.ingest_crawl_items(
			'arcalive',
			'[
				{"url":"https://thread.test/ingest-before-reject","type":"normal"},
				{"url":"https://thread.test/ingest-reject","type":"normal"}
			]'::jsonb
		)
	$$,
	'reject thread insert',
	'failed ingest rolls back the whole batch'
);
reset role;
select is(
	(select count(*) from public.threads where url like 'https://thread.test/ingest-%-reject'),
	0::bigint,
	'failed ingest leaves no partial rows'
);
drop trigger reject_thread_insert on public.threads;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
	$$select * from public.list_threads_page('inbox')$$,
	'42501',
	'Only the Applemint owner can list threads.',
	'non-owner cannot page threads'
);
reset role;

insert into public.threads (
	type, url, state, created_at, captured_at, state_changed_at
)
values
	('page-normal', 'https://page.test/1', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00'),
	('page-normal', 'https://page.test/2', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-02 00:00:00+00'),
	('page-special', 'https://page.test/3', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-03 00:00:00+00'),
	('page-special', 'https://page.test/4', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-04 00:00:00+00'),
	('page-normal', 'https://page.test/5', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-05 00:00:00+00'),
	('page-normal', 'https://page.test/saved', 'saved', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-06 00:00:00+00');

select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);

create temporary table page_one as
select * from public.list_threads_page('inbox', 2, null, null, null);

select is((select count(*) from page_one), 3::bigint, 'pagination returns one look-ahead row');
select is(
	(select url from page_one order by state_changed_at desc, id desc limit 1),
	'https://page.test/5',
	'first page starts with the newest state transition'
);
select is(
	(select url from page_one order by state_changed_at desc, id desc offset 1 limit 1),
	'https://page.test/4',
	'first page preserves deterministic cursor order'
);

create temporary table page_two as
select *
from public.list_threads_page(
	'inbox',
	2,
	(select state_changed_at from page_one order by state_changed_at desc, id desc offset 1 limit 1),
	(select id::bigint from page_one order by state_changed_at desc, id desc offset 1 limit 1),
	null
);

select is(
	(select url from page_two order by state_changed_at desc, id desc limit 1),
	'https://page.test/3',
	'cursor resumes immediately after the last emitted row'
);
select is(
	(
		select count(*)
		from (
			(select id from page_one order by state_changed_at desc, id desc limit 2)
			union all
			(select id from page_two order by state_changed_at desc, id desc limit 3)
		) as paged
	),
	5::bigint,
	'two pages expose every inbox row'
);
select is(
	(
		select count(distinct id)
		from (
			(select id from page_one order by state_changed_at desc, id desc limit 2)
			union all
			(select id from page_two order by state_changed_at desc, id desc limit 3)
		) as paged
	),
	5::bigint,
	'cursor pages contain no duplicate IDs'
);
select is(
	(select count(*) from public.list_threads_page('inbox', 24, null, null, 'page-special')),
	2::bigint,
	'type filter is applied inside the canonical query'
);
select is(
	(select count(*) from public.list_threads_page('saved', 24, null, null, 'page-normal')),
	1::bigint,
	'state filter keeps saved rows out of inbox pages'
);

-- Isolate the exact normal-site denominator after the preceding canonical tests.
update public.threads
set type = 'site-test-baseline'
where state = 'inbox' and type = 'normal';

insert into public.threads (type, url, host, state, state_changed_at)
select
	'normal',
	'https://site-filter.test/count-only/' || value,
	'https://www.count-only.test/',
	'inbox',
	'2202-01-01 00:00:00+00'::timestamp with time zone + make_interval(secs => value)
from generate_series(1, 10) as value
union all
select
	'normal',
	'https://site-filter.test/dominant/' || value,
	case
		when value <= 20 then 'www.fmkorea.com'
		when value <= 30 then 'https://www.fmkorea.com'
		else 'm.fmkorea.com'
	end,
	'inbox',
	'2202-01-02 00:00:00+00'::timestamp with time zone + make_interval(secs => value)
from generate_series(1, 41) as value;

select ok(
	not exists (
		select 1 from public.get_normal_site_stats()
		where site_key = 'count-only.test'
	),
	'site count alone does not qualify below the twenty-percent share'
);
select is(
	(
		select row(count(*), count(*) filter (where host = 'https://www.count-only.test/'))
		from public.list_threads_page('inbox', 100, null, null, 'normal', null)
		where url like 'https://site-filter.test/%'
	),
	row(10::bigint, 10::bigint),
	'Normal excludes every alias of the promoted site while retaining non-promoted rows'
);
select is(
	(
		select count(*)
		from public.list_threads_page('inbox', 100, null, null, null, null)
		where url like 'https://site-filter.test/%'
	),
	51::bigint,
	'All retains promoted and non-promoted normal rows exactly once'
);
select is(
	(
		select count(*)
		from public.list_threads_page(
			'inbox', 100, null, null, 'normal', 'fmkorea.com'
		)
	),
	41::bigint,
	'promoted site filter retains every raw host alias excluded from Normal'
);

select is(
	public.get_thread_stats_with_normal_sites('inbox', null) -> 'sites' -> 0 ->> 'site_key',
	'fmkorea.com',
	'atomic statistics expose the canonical promoted site key'
);

delete from public.threads where url like 'https://site-filter.test/%';
insert into public.threads (type, url, host, state, state_changed_at)
select
	'normal',
	'https://site-filter.test/ratio-only/' || value,
	'https://www.ratio-only.test/',
	'inbox',
	'2202-02-01 00:00:00+00'::timestamp with time zone + make_interval(secs => value)
from generate_series(1, 9) as value
union all
select
	'normal',
	'https://site-filter.test/ratio-denominator/' || value,
	'https://www.ratio-denominator.test/',
	'inbox',
	'2202-02-02 00:00:00+00'::timestamp with time zone + make_interval(secs => value)
from generate_series(1, 36) as value;

select ok(
	not exists (
		select 1 from public.get_normal_site_stats()
		where site_key = 'ratio-only.test'
	),
	'twenty-percent share alone does not qualify below ten items'
);

delete from public.threads where url like 'https://site-filter.test/%';
insert into public.threads (type, url, host, state, state_changed_at)
select
	'normal',
	format('https://site-filter.test/final/%s/%s', host_key, value),
	format('https://www.%s.test/', host_key),
	'inbox',
	'2202-03-01 00:00:00+00'::timestamp with time zone
		+ make_interval(secs => host_order * 100 + value)
from (values ('a', 1), ('b', 2), ('c', 3), ('d', 4), ('e', 5)) as hosts(host_key, host_order)
cross join generate_series(1, 10) as value;

insert into public.threads (type, url, host, state, state_changed_at)
values
	('normal', 'https://site-filter.test/final/saved', 'https://www.a.test/', 'saved', '2202-03-02 00:00:00+00'),
	('youtube', 'https://site-filter.test/final/youtube', 'https://www.a.test/', 'inbox', '2202-03-02 00:00:01+00');

select is(
	(
		select string_agg(site_key, ',' order by count desc, site_key asc)
		from public.get_normal_site_stats()
	),
	'a.test,b.test,c.test,d.test,e.test',
	'exactly five qualifying sites are ordered by count then canonical key'
);
select is(
	(
		select count(*)
		from public.list_threads_page(
			'inbox', 100, null, null, 'normal', 'a.test'
		)
	),
	10::bigint,
	'site filtering isolates inbox normal rows from other states and types'
);

create temporary table site_page_one as
select *
from public.list_threads_page(
	'inbox', 4, null, null, 'normal', 'a.test'
);
create temporary table site_page_two as
select *
from public.list_threads_page(
	'inbox',
	10,
	(select state_changed_at from site_page_one order by state_changed_at desc, id desc offset 3 limit 1),
	(select id::bigint from site_page_one order by state_changed_at desc, id desc offset 3 limit 1),
	'normal',
	'a.test'
);
select is(
	(
		select row(count(*), count(distinct id))
		from (
			(select id from site_page_one order by state_changed_at desc, id desc limit 4)
			union all
			(select id from site_page_two order by state_changed_at desc, id desc)
		) as paged
	),
	row(10::bigint, 10::bigint),
	'site-filtered cursor pages contain every row exactly once'
);
select throws_ok(
	$$select * from public.list_threads_page('inbox', 24, null, null, 'youtube', 'a.test')$$,
	'22023',
	'Thread site filters require the normal thread type.',
	'site filtering cannot escape the normal type boundary'
);

insert into public.threads (
	id, type, url, state, created_at, captured_at, state_changed_at
)
values (
	9007199254740993,
	'bigint-contract',
	'https://page.test/bigint-contract',
	'inbox',
	'2201-01-01 00:00:00+00',
	'2201-01-01 00:00:00+00',
	'2201-01-01 00:00:00+00'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	(
		select id
		from public.list_threads_page('inbox', 24, null, null, 'bigint-contract')
	),
	'9007199254740993',
	'list RPC serializes bigint IDs as lossless decimal text'
);
select is(
	public.transition_thread_state(
		9007199254740993,
		'inbox',
		'saved'
	) ->> 'id',
	'9007199254740993',
	'transition RPC serializes bigint IDs as lossless decimal text'
);
reset role;

select * from finish();
rollback;
