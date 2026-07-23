begin;

select plan(19);

select is(
	(
		select count(*)
		from pg_indexes
		where schemaname = 'public'
			and indexname in ('idx_quick_save_created_at_id', 'idx_trash_created_at_id')
	),
	2::bigint,
	'quick-save and trash have composite pagination indexes'
);
select ok(
	not has_function_privilege(
		'anon',
		'public.list_thread_page(text,integer,timestamp with time zone,bigint,text)',
		'EXECUTE'
	),
	'anon cannot list thread pages'
);
select ok(
	has_function_privilege(
		'authenticated',
		'public.list_thread_page(text,integer,timestamp with time zone,bigint,text)',
		'EXECUTE'
	),
	'authenticated can execute the owner-protected list RPC'
);
select ok(
	not has_function_privilege(
		'service_role',
		'public.list_thread_page(text,integer,timestamp with time zone,bigint,text)',
		'EXECUTE'
	),
	'service role cannot use the owner list RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
	$$select * from public.list_thread_page('new-threads')$$,
	'42501',
	'Only the Applemint owner can list threads.',
	'non-owner cannot list threads'
);
reset role;

create temporary table p1_baseline_new_threads (
	id bigint primary key,
	created_at timestamp with time zone not null,
	url text not null
);
create temporary table p1_new_thread_results (
	stage text not null,
	id bigint not null,
	created_at timestamp with time zone not null,
	url text not null
);
create temporary table p1_cursor (
	key text primary key,
	created_at timestamp with time zone not null,
	id bigint not null
);

with inserted as (
	insert into public.threads (state_changed_at, type, url, title, host, state)
	values
		('2026-01-01 00:00:02+00', 'p1-pagination', 'https://p1.test/baseline-1', 'baseline 1', 'p1.test', 'inbox'),
		('2026-01-01 00:00:02+00', 'p1-pagination', 'https://p1.test/baseline-2', 'baseline 2', 'p1.test', 'inbox'),
		('2026-01-01 00:00:01+00', 'p1-pagination', 'https://p1.test/baseline-3', 'baseline 3', 'p1.test', 'inbox'),
		('2026-01-01 00:00:01+00', 'p1-pagination', 'https://p1.test/baseline-4', 'baseline 4', 'p1.test', 'inbox')
	returning id, state_changed_at, url
)
insert into p1_baseline_new_threads
select id, state_changed_at, url from inserted;

grant select, insert, update, delete on
	p1_baseline_new_threads,
	p1_new_thread_results,
	p1_cursor
to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	$$select * from public.list_thread_page('new-threads', 2, null, null, 'p1-pagination')$$,
	'owner can list a thread page'
);
select is(
	(
		select array_agg(id order by created_at desc, id desc)
		from (
			select id, created_at
			from public.list_thread_page('new-threads', 2, null, null, 'p1-pagination')
			order by created_at desc, id desc
			limit 2
		) as first_page
	),
	(
		select array_agg(id order by created_at desc, id desc)
		from (
			select id, created_at
			from p1_baseline_new_threads
			order by created_at desc, id desc
			limit 2
		) as expected_page
	),
	'equal timestamps are ordered by descending id'
);

insert into p1_new_thread_results (stage, id, created_at, url)
select 'first', id, created_at, url
from public.list_thread_page('new-threads', 2, null, null, 'p1-pagination')
order by created_at desc, id desc
limit 2;

insert into p1_cursor (key, created_at, id)
select 'new-threads', created_at, id
from p1_new_thread_results
where stage = 'first'
order by created_at asc, id asc
limit 1;
reset role;

set local role service_role;
select public.ingest_crawl_items(
	'arcalive',
	'[{"url":"https://p1.test/ingested","title":"ingested","host":"p1.test","type":"p1-pagination"}]'::jsonb
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
insert into p1_new_thread_results (stage, id, created_at, url)
select 'after-ingest', page.id, page.created_at, page.url
from p1_cursor as cursor_state
cross join lateral public.list_thread_page(
	'new-threads',
	100,
	cursor_state.created_at,
	cursor_state.id,
	'p1-pagination'
) as page
where cursor_state.key = 'new-threads';

select is(
	(select count(*) from p1_new_thread_results where stage in ('first', 'after-ingest')),
	4::bigint,
	'ingest between pages does not omit baseline rows'
);
select is(
	(
		select count(distinct id)
		from p1_new_thread_results
		where stage in ('first', 'after-ingest')
	),
	4::bigint,
	'ingest between pages does not duplicate baseline rows'
);
select ok(
	not exists (
		select 1 from p1_new_thread_results
		where stage = 'after-ingest' and url = 'https://p1.test/ingested'
	),
	'newly ingested head item is excluded from the previous cursor continuation'
);
select ok(
	exists (
		select 1
		from public.list_thread_page('new-threads', 24, null, null, 'p1-pagination')
		where url = 'https://p1.test/ingested'
	),
	'a refreshed first page includes the newly ingested item'
);
reset role;

create temporary table p1_restore_state (id bigint primary key);
with restored_source as (
	insert into public.threads (type, url, title, host, state)
	values ('p1-pagination', 'https://p1.test/restored', 'restored', 'p1.test', 'trash')
	returning id
)
insert into p1_restore_state (id)
select id from restored_source;
grant select on p1_restore_state to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select public.move_thread(
	(select id from p1_restore_state),
	'trash',
	'new-threads'
);
insert into p1_new_thread_results (stage, id, created_at, url)
select 'after-restore', page.id, page.created_at, page.url
from p1_cursor as cursor_state
cross join lateral public.list_thread_page(
	'new-threads',
	100,
	cursor_state.created_at,
	cursor_state.id,
	'p1-pagination'
) as page
where cursor_state.key = 'new-threads';

select is(
	(select count(*) from p1_new_thread_results where stage = 'after-restore'),
	2::bigint,
	'restore between pages preserves the previous cursor continuation'
);
select ok(
	not exists (
		select 1 from p1_new_thread_results
		where stage = 'after-restore' and url = 'https://p1.test/restored'
	),
	'restored head item is excluded from the previous cursor continuation'
);
select ok(
	exists (
		select 1
		from public.list_thread_page('new-threads', 24, null, null, 'p1-pagination')
		where url = 'https://p1.test/restored'
	),
	'a refreshed first page includes the restored item'
);
reset role;

insert into public.threads (state_changed_at, type, url, title, host, state)
select
	'2026-02-01 00:00:00+00'::timestamp with time zone - (item_number || ' seconds')::interval,
	'p1-page-depth',
	'https://p1.test/quick-' || item_number,
	'quick ' || item_number,
	'p1.test',
	'saved'
from generate_series(1, 55) as items(item_number);

insert into public.threads (state_changed_at, type, url, title, host, state)
select
	'2026-02-01 00:00:00+00'::timestamp with time zone - (item_number || ' seconds')::interval,
	'p1-page-depth',
	'https://p1.test/trash-' || item_number,
	'trash ' || item_number,
	'p1.test',
	'trash'
from generate_series(1, 55) as items(item_number);

create temporary table p1_quick_results (
	id bigint not null,
	created_at timestamp with time zone not null
);
create temporary table p1_trash_results (
	id bigint not null,
	created_at timestamp with time zone not null
);
grant select, insert on p1_quick_results, p1_trash_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
do $$
declare
	v_cursor_created_at timestamp with time zone;
	v_cursor_id bigint;
	v_row_count integer;
begin
	loop
		insert into p1_quick_results (id, created_at)
		select id, created_at
		from public.list_thread_page(
			'quick-save', 24, v_cursor_created_at, v_cursor_id, 'p1-page-depth'
		)
		order by created_at desc, id desc
		limit 24;
		get diagnostics v_row_count = row_count;
		exit when v_row_count < 24;
		select created_at, id
		into v_cursor_created_at, v_cursor_id
		from p1_quick_results
		order by created_at asc, id asc
		limit 1;
	end loop;
end;
$$;

do $$
declare
	v_cursor_created_at timestamp with time zone;
	v_cursor_id bigint;
	v_row_count integer;
begin
	loop
		insert into p1_trash_results (id, created_at)
		select id, created_at
		from public.list_thread_page(
			'trash', 24, v_cursor_created_at, v_cursor_id, 'p1-page-depth'
		)
		order by created_at desc, id desc
		limit 24;
		get diagnostics v_row_count = row_count;
		exit when v_row_count < 24;
		select created_at, id
		into v_cursor_created_at, v_cursor_id
		from p1_trash_results
		order by created_at asc, id asc
		limit 1;
	end loop;
end;
$$;

select is((select count(*) from p1_quick_results), 55::bigint, 'quick-save exposes rows past 50');
select is(
	(select count(distinct id) from p1_quick_results),
	55::bigint,
	'quick-save pages contain no duplicate rows'
);
select is((select count(*) from p1_trash_results), 55::bigint, 'trash exposes rows past 50');
select is(
	(select count(distinct id) from p1_trash_results),
	55::bigint,
	'trash pages contain no duplicate rows'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select throws_ok(
	$$select * from public.list_thread_page('unsupported')$$,
	'22023',
	'Unsupported thread list: unsupported',
	'owner cannot request an unsupported thread list'
);
reset role;

select * from finish();
rollback;
