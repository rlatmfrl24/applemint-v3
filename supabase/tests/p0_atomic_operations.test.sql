begin;

select plan(30);

select ok(
	not has_function_privilege('anon', 'public.move_thread(bigint,text,text)', 'EXECUTE'),
	'anon cannot execute move_thread'
);
select ok(
	not has_function_privilege('anon', 'public.bulk_move_new_threads_to_trash()', 'EXECUTE'),
	'anon cannot execute bulk move'
);
select ok(
	not has_function_privilege('anon', 'public.ingest_crawl_items(text,jsonb)', 'EXECUTE'),
	'anon cannot execute ingest'
);
select ok(
	not has_function_privilege('authenticated', 'public.ingest_crawl_items(text,jsonb)', 'EXECUTE'),
	'authenticated cannot execute ingest'
);
select ok(
	has_function_privilege('service_role', 'public.ingest_crawl_items(text,jsonb)', 'EXECUTE'),
	'service_role can execute ingest'
);
select ok(
	not has_function_privilege(
		'authenticated',
		'public.acquire_crawl_lock(text,uuid,integer)',
		'EXECUTE'
	),
	'authenticated cannot acquire crawl lock'
);
select ok(
	has_function_privilege('service_role', 'public.acquire_crawl_lock(text,uuid,integer)', 'EXECUTE'),
	'service_role can acquire crawl lock'
);

create temporary table p0_test_state (
	key text primary key,
	value bigint not null
);

grant select on p0_test_state to authenticated, service_role;

with inserted as (
	insert into public."new-threads" (
		type,
		url,
		title,
		description,
		host,
		tag,
		sub_url,
		captured_at
	)
	values (
		'normal',
		'https://p0.test/move',
		'move',
		'move description',
		'p0.test',
		array['p0', 'tag'],
		array['https://p0.test/media.jpg'],
		'2026-07-19 12:34:56+00'::timestamptz
	)
	returning id
)
insert into p0_test_state (key, value)
select 'move_id', id from inserted;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	format(
		'select public.move_thread(%s, %L, %L)',
		(select value from p0_test_state where key = 'move_id'),
		'new-threads',
		'quick-save'
	),
	'move_thread moves a row atomically'
);
reset role;

select is(
	(select count(*) from public."new-threads" where url = 'https://p0.test/move'),
	0::bigint,
	'moved source row is removed'
);
select is(
	(select tag from public."quick-save" where url = 'https://p0.test/move'),
	array['p0', 'tag']::text[],
	'tag is preserved'
);
select is(
	(select sub_url from public."quick-save" where url = 'https://p0.test/move'),
	array['https://p0.test/media.jpg']::text[],
	'sub_url is preserved'
);
select ok(
	(select captured_at from public."quick-save" where url = 'https://p0.test/move') =
		'2026-07-19 12:34:56+00'::timestamptz,
	'captured_at is preserved'
);

create function pg_temp.reject_quick_save_insert()
returns trigger
language plpgsql
as $$
begin
	raise exception 'forced destination failure';
end;
$$;

create trigger p0_reject_quick_save_insert
before insert on public."quick-save"
for each row execute function pg_temp.reject_quick_save_insert();

with inserted as (
	insert into public."new-threads" (type, url, title, host)
	values ('normal', 'https://p0.test/rollback-move', 'rollback move', 'p0.test')
	returning id
)
insert into p0_test_state (key, value)
select 'rollback_move_id', id from inserted;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select throws_ok(
	format(
		'select public.move_thread(%s, %L, %L)',
		(select value from p0_test_state where key = 'rollback_move_id'),
		'new-threads',
		'quick-save'
	),
	'P0001',
	'forced destination failure',
	'destination insert failure rolls back the move'
);
reset role;

select is(
	(select count(*) from public."new-threads" where url = 'https://p0.test/rollback-move'),
	1::bigint,
	'source row remains after destination failure'
);

drop trigger p0_reject_quick_save_insert on public."quick-save";

insert into public."new-threads" (type, url, title, host)
values
	('normal', 'https://p0.test/bulk-1', 'bulk 1', 'p0.test'),
	('normal', 'https://p0.test/bulk-2', 'bulk 2', 'p0.test');

insert into p0_test_state (key, value)
select 'bulk_source_count', count(*) from public."new-threads";
insert into p0_test_state (key, value)
select 'trash_before', count(*) from public.trash;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	public.bulk_move_new_threads_to_trash(),
	(select value from p0_test_state where key = 'bulk_source_count'),
	'bulk move returns the moved row count'
);
reset role;

select is(
	(select count(*) from public."new-threads"),
	0::bigint,
	'bulk move removes every source row'
);
select is(
	(select count(*) from public.trash),
	(select value from p0_test_state where key = 'trash_before') +
		(select value from p0_test_state where key = 'bulk_source_count'),
	'bulk move destination delta matches its return value'
);

set local role service_role;
select is(
	public.ingest_crawl_items(
		'arcalive',
		'[
			{"url":"https://p0.test/ingest-1","title":"one","host":"p0.test","type":"normal","tag":["a"],"sub_url":[]},
			{"url":"https://p0.test/ingest-1","title":"duplicate","host":"p0.test","type":"normal"},
			{"url":"https://p0.test/ingest-2","title":"two","host":"p0.test","type":"media","sub_url":["https://p0.test/two.jpg"]}
		]'::jsonb
	),
	'{"insertedCount": 2, "skippedCount": 0}'::jsonb,
	'ingest deduplicates a payload and inserts newly claimed URLs'
);
reset role;

select is(
	(select count(*) from public."crawl-history" where url like 'https://p0.test/ingest-%'),
	2::bigint,
	'ingest creates one history row per URL'
);
select is(
	(select count(*) from public."new-threads" where url like 'https://p0.test/ingest-%'),
	2::bigint,
	'ingest creates one new thread per URL'
);

set local role service_role;
select is(
	public.ingest_crawl_items(
		'arcalive',
		'[
			{"url":"https://p0.test/ingest-1","title":"one"},
			{"url":"https://p0.test/ingest-2","title":"two"}
		]'::jsonb
	),
	'{"insertedCount": 0, "skippedCount": 2}'::jsonb,
	'repeated ingest skips URLs already claimed by the unique index'
);
reset role;

select is(
	(select count(*) from public."crawl-history" where url like 'https://p0.test/ingest-%'),
	2::bigint,
	'repeated ingest does not duplicate history'
);
select is(
	(select count(*) from public."new-threads" where url like 'https://p0.test/ingest-%'),
	2::bigint,
	'repeated ingest does not duplicate new threads'
);

create function pg_temp.reject_new_thread_insert()
returns trigger
language plpgsql
as $$
begin
	raise exception 'forced new-thread failure';
end;
$$;

create trigger p0_reject_new_thread_insert
before insert on public."new-threads"
for each row execute function pg_temp.reject_new_thread_insert();

set local role service_role;
select throws_ok(
	$$
		select public.ingest_crawl_items(
			'arcalive',
			'[{"url":"https://p0.test/ingest-rollback","title":"rollback"}]'::jsonb
		)
	$$,
	'P0001',
	'forced new-thread failure',
	'new-thread insert failure rolls back the history claim'
);
reset role;

select is(
	(select count(*) from public."crawl-history" where url = 'https://p0.test/ingest-rollback'),
	0::bigint,
	'failed ingest leaves no history claim'
);
select is(
	(select count(*) from public."new-threads" where url = 'https://p0.test/ingest-rollback'),
	0::bigint,
	'failed ingest leaves no new thread'
);

drop trigger p0_reject_new_thread_insert on public."new-threads";

set local role service_role;
select ok(
	public.acquire_crawl_lock(
		'global-test',
		'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
		300
	),
	'first caller acquires the global crawl lock'
);
select ok(
	not public.acquire_crawl_lock(
		'global-test',
		'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
		300
	),
	'second caller cannot acquire an active lock'
);
select ok(
	not public.release_crawl_lock(
		'global-test',
		'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
	),
	'non-owner cannot release the lock'
);
select ok(
	public.release_crawl_lock(
		'global-test',
		'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
	),
	'lock owner can release the lock'
);
reset role;

select * from finish();
rollback;
