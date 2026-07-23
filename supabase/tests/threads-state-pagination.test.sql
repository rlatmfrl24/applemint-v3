-- Canonical thread state, pagination, and atomicity contract.
begin;

select plan(35);

select has_table('public', 'threads', 'threads is the canonical table');
select has_index('public', 'threads', 'idx_threads_state_changed_at_id', 'state cursor index exists');
select has_index(
	'public',
	'threads',
	'idx_threads_state_type_changed_at_id',
	'state and type cursor index exists'
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
	(select id from page_one order by state_changed_at desc, id desc offset 1 limit 1),
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

select * from finish();
rollback;
