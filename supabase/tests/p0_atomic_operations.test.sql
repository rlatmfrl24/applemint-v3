begin;

select plan(16);

select ok(
	not has_function_privilege(
		'anon',
		'public.transition_thread_state(bigint,text,text)',
		'EXECUTE'
	),
	'anon cannot transition threads'
);
select ok(
	not has_function_privilege('anon', 'public.bulk_move_inbox_to_trash()', 'EXECUTE'),
	'anon cannot bulk move inbox threads'
);
select ok(
	not has_function_privilege('anon', 'public.ingest_crawl_items(text,jsonb)', 'EXECUTE'),
	'anon cannot ingest crawl items'
);

insert into public.threads (
	type, url, title, description, host, tag, state, created_at, captured_at, state_changed_at
)
values (
	'p0',
	'https://p0.test/move',
	'move title',
	'move description',
	'p0.test',
	array['atomic'],
	'inbox',
	'2026-01-01 00:00:00+00',
	'2026-01-01 00:00:00+00',
	'2026-01-01 00:00:00+00'
);

create temporary table p0_original as
select id, created_at, captured_at
from public.threads
where url = 'https://p0.test/move';
grant select on p0_original to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(select id from p0_original),
		'inbox',
		'saved'
	),
	'thread transition completes atomically'
);
reset role;

select is(
	(select state from public.threads where url = 'https://p0.test/move'),
	'saved',
	'transition changes only the canonical state'
);
select is(
	(select id from public.threads where url = 'https://p0.test/move'),
	(select id from p0_original),
	'transition preserves the ID'
);
select ok(
	(select row(title, description, tag, created_at, captured_at) from public.threads where url = 'https://p0.test/move')
		is not distinct from
	(select row('move title'::text, 'move description'::text, array['atomic']::text[], created_at, captured_at) from p0_original),
	'transition preserves content and capture times'
);

create function pg_temp.reject_p0_update()
returns trigger
language plpgsql
as $$
begin
	raise exception 'reject p0 update';
end;
$$;

create trigger p0_reject_thread_update
before update on public.threads
for each row
when (old.url = 'https://p0.test/rollback-move')
execute function pg_temp.reject_p0_update();

insert into public.threads (type, url, state)
values ('p0', 'https://p0.test/rollback-move', 'inbox');

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select throws_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(select id from public.threads where url = 'https://p0.test/rollback-move'),
		'inbox',
		'saved'
	),
	'reject p0 update',
	'failed transition rolls back the state update'
);
reset role;
select is(
	(select state from public.threads where url = 'https://p0.test/rollback-move'),
	'inbox',
	'failed transition leaves the source state intact'
);
drop trigger p0_reject_thread_update on public.threads;
delete from public.threads where url = 'https://p0.test/rollback-move';

create temporary table p0_bulk_baseline as
select count(*)::bigint as inbox_count
from public.threads
where state = 'inbox';
grant select on p0_bulk_baseline to authenticated;

insert into public.threads (type, url, state)
values
	('p0-bulk', 'https://p0.test/bulk-1', 'inbox'),
	('p0-bulk', 'https://p0.test/bulk-2', 'inbox');

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	public.bulk_move_inbox_to_trash(),
	(select inbox_count + 2 from p0_bulk_baseline),
	'bulk transition reports its moved count'
);
reset role;
select is(
	(select count(*) from public.threads where type = 'p0-bulk' and state = 'inbox'),
	0::bigint,
	'bulk transition clears matching inbox rows'
);
select is(
	(select count(*) from public.threads where type = 'p0-bulk' and state = 'trash'),
	2::bigint,
	'bulk transition moves every matching row to trash'
);

set local role service_role;
select is(
	public.ingest_crawl_items(
		'arcalive',
		'[
			{"url":"https://p0.test/ingest-1","title":"one","type":"normal"},
			{"url":"https://p0.test/ingest-2","title":"two","type":"normal"}
		]'::jsonb
	),
	'{"insertedCount": 2, "skippedCount": 0}'::jsonb,
	'ingest inserts a batch atomically'
);
reset role;
select is(
	(select count(*) from public.threads where url like 'https://p0.test/ingest-%' and state = 'inbox'),
	2::bigint,
	'ingest writes every accepted item to the canonical inbox'
);

create function pg_temp.reject_p0_insert()
returns trigger
language plpgsql
as $$
begin
	if new.url = 'https://p0.test/ingest-reject' then
		raise exception 'reject p0 insert';
	end if;
	return new;
end;
$$;

create trigger p0_reject_thread_insert
before insert on public.threads
for each row execute function pg_temp.reject_p0_insert();

set local role service_role;
select throws_ok(
	$$
		select public.ingest_crawl_items(
			'arcalive',
			'[
				{"url":"https://p0.test/ingest-before-reject","type":"normal"},
				{"url":"https://p0.test/ingest-reject","type":"normal"}
			]'::jsonb
		)
	$$,
	'reject p0 insert',
	'failed ingest rolls back the whole batch'
);
reset role;
select is(
	(select count(*) from public.threads where url like 'https://p0.test/ingest-%-reject'),
	0::bigint,
	'failed ingest leaves no partial rows'
);

select * from finish();
rollback;
