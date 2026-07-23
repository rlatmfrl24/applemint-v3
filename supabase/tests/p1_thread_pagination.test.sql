begin;

select plan(13);

select has_index(
	'public',
	'threads',
	'idx_threads_state_changed_at_id',
	'canonical state pagination index exists'
);
select has_index(
	'public',
	'threads',
	'idx_threads_state_type_changed_at_id',
	'canonical state and type pagination index exists'
);
select ok(
	has_function_privilege(
		'authenticated',
		'public.list_threads_page(text,integer,timestamp with time zone,bigint,text)',
		'EXECUTE'
	),
	'authenticated can execute canonical pagination'
);
select ok(
	not has_function_privilege(
		'anon',
		'public.list_threads_page(text,integer,timestamp with time zone,bigint,text)',
		'EXECUTE'
	),
	'anon cannot execute canonical pagination'
);

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
	('p1-normal', 'https://p1.test/1', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00'),
	('p1-normal', 'https://p1.test/2', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-02 00:00:00+00'),
	('p1-special', 'https://p1.test/3', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-03 00:00:00+00'),
	('p1-special', 'https://p1.test/4', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-04 00:00:00+00'),
	('p1-normal', 'https://p1.test/5', 'inbox', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-05 00:00:00+00'),
	('p1-normal', 'https://p1.test/saved', 'saved', '2200-01-01 00:00:00+00', '2200-01-01 00:00:00+00', '2200-01-06 00:00:00+00');

select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);

create temporary table p1_page_one as
select * from public.list_threads_page('inbox', 2, null, null, null);

select is(
	(select count(*) from p1_page_one),
	3::bigint,
	'pagination returns one look-ahead row'
);
select is(
	(select url from p1_page_one order by state_changed_at desc, id desc limit 1),
	'https://p1.test/5',
	'first page starts with the newest state transition'
);
select is(
	(select url from p1_page_one order by state_changed_at desc, id desc offset 1 limit 1),
	'https://p1.test/4',
	'first page preserves deterministic cursor order'
);

create temporary table p1_page_two as
select *
from public.list_threads_page(
	'inbox',
	2,
	(select state_changed_at from p1_page_one order by state_changed_at desc, id desc offset 1 limit 1),
	(select id from p1_page_one order by state_changed_at desc, id desc offset 1 limit 1),
	null
);

select is(
	(select url from p1_page_two order by state_changed_at desc, id desc limit 1),
	'https://p1.test/3',
	'cursor resumes immediately after the last emitted row'
);
select is(
	(
		select count(*)
		from (
			(select id from p1_page_one order by state_changed_at desc, id desc limit 2)
			union all
			(select id from p1_page_two order by state_changed_at desc, id desc limit 3)
		) as paged
	),
	5::bigint,
	'two pages expose every inbox row'
);
select is(
	(
		select count(distinct id)
		from (
			(select id from p1_page_one order by state_changed_at desc, id desc limit 2)
			union all
			(select id from p1_page_two order by state_changed_at desc, id desc limit 3)
		) as paged
	),
	5::bigint,
	'cursor pages contain no duplicate IDs'
);
select is(
	(select count(*) from public.list_threads_page('inbox', 24, null, null, 'p1-special')),
	2::bigint,
	'type filter is applied inside the canonical query'
);
select is(
	(select count(*) from public.list_threads_page('saved', 24, null, null, null)),
	1::bigint,
	'state filter keeps saved rows out of inbox pages'
);

select * from finish();
rollback;
