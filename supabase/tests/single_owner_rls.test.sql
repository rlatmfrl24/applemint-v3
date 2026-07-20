begin;

select plan(31);

select ok(
	not exists (
		select 1
		from unnest(array[
			'public."crawl-history"',
			'public."filter-keyword"',
			'public."new-threads"',
			'public."quick-save"',
			'public.trash',
			'public.crawl_run_locks'
		]) as business_table(table_name)
		cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
		where has_table_privilege('anon', business_table.table_name, access.privilege_name)
	),
	'anon has no CRUD privilege on any business table'
);
select ok(
	not exists (
		select 1
		from unnest(array[
			'public.is_applemint_owner()',
			'public.move_thread(bigint,text,text)',
			'public.bulk_move_new_threads_to_trash()',
			'public.get_new_threads_stats(text,text,text)',
			'public.clean_trash()',
			'public.ingest_crawl_items(text,jsonb)',
			'public.acquire_crawl_lock(text,uuid,integer)',
			'public.release_crawl_lock(text,uuid)'
		]) as business_function(function_name)
		where has_function_privilege('anon', business_function.function_name, 'EXECUTE')
	),
	'anon cannot execute any business RPC'
);
select ok(
	not exists (
		select 1
		from unnest(array['anon', 'authenticated']) as application_role(role_name)
		cross join unnest(array[
			'public."crawl-history_id_seq"',
			'public."filter-keyword_id_seq"',
			'public."new-threads_id_seq"',
			'public."quick-save_id_seq"',
			'public.trash_id_seq'
		]) as business_sequence(sequence_name)
		cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as access(privilege_name)
		where has_sequence_privilege(
			application_role.role_name,
			business_sequence.sequence_name,
			access.privilege_name
		)
	),
	'anon and authenticated have no privilege on any business sequence'
);
select ok(
	not exists (
		select 1
		from unnest(array[
			'public."new-threads"',
			'public."quick-save"',
			'public.trash'
		]) as thread_table(table_name)
		cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
		where has_table_privilege('authenticated', thread_table.table_name, access.privilege_name)
	),
	'authenticated cannot change any thread table directly'
);
select ok(
	not exists (
		select 1
		from unnest(array[
			'public."crawl-history"',
			'public."filter-keyword"',
			'public.crawl_run_locks'
		]) as internal_table(table_name)
		cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
		where has_table_privilege('authenticated', internal_table.table_name, access.privilege_name)
	),
	'authenticated cannot access crawler-internal tables'
);
select ok(
	has_table_privilege('service_role', 'public."filter-keyword"', 'SELECT')
		and has_table_privilege('service_role', 'public.crawl_run_locks', 'INSERT,UPDATE,DELETE'),
	'service role retains filter and crawl lock table access'
);

select ok(
	not has_table_privilege('anon', 'public."new-threads"', 'SELECT'),
	'anon cannot read new threads'
);
select ok(
	not has_table_privilege('anon', 'public."crawl-history"', 'INSERT'),
	'anon cannot insert crawl history'
);
select ok(
	has_table_privilege('authenticated', 'public."new-threads"', 'SELECT'),
	'authenticated has the select privilege required for owner RLS'
);
select ok(
	not has_table_privilege('authenticated', 'public."new-threads"', 'INSERT'),
	'authenticated cannot insert new threads directly'
);
select ok(
	not has_table_privilege('authenticated', 'public."quick-save"', 'DELETE'),
	'authenticated cannot delete quick saves directly'
);
select ok(
	not has_table_privilege('authenticated', 'public.trash', 'UPDATE'),
	'authenticated cannot update trash directly'
);
select ok(
	not has_function_privilege('anon', 'public.is_applemint_owner()', 'EXECUTE'),
	'anon cannot execute the owner check'
);
select ok(
	has_function_privilege('authenticated', 'public.is_applemint_owner()', 'EXECUTE'),
	'authenticated can execute the owner check'
);
select ok(
	not has_function_privilege('anon', 'public.clean_trash()', 'EXECUTE'),
	'anon cannot clean trash'
);
select ok(
	not has_function_privilege('authenticated', 'public.clean_trash()', 'EXECUTE'),
	'authenticated cannot clean trash'
);
select ok(
	has_function_privilege('service_role', 'public.clean_trash()', 'EXECUTE'),
	'service role can clean trash'
);
select ok(
	has_function_privilege('service_role', 'public.ingest_crawl_items(text,jsonb)', 'EXECUTE'),
	'service role retains ingest access'
);

insert into public."new-threads" (type, url, title, host)
values ('normal', 'https://owner.test/new', 'owner new', 'owner.test');
insert into public."quick-save" (type, url, title, host)
values ('normal', 'https://owner.test/quick', 'owner quick', 'owner.test');
insert into public.trash (type, url, title, host)
values ('normal', 'https://owner.test/trash', 'owner trash', 'owner.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(public.is_applemint_owner(), false, 'another authenticated user is not the owner');
select is(
	(select count(*) from public."new-threads" where url = 'https://owner.test/new'),
	0::bigint,
	'non-owner cannot read new threads'
);
select is(
	(select count(*) from public."quick-save" where url = 'https://owner.test/quick'),
	0::bigint,
	'non-owner cannot read quick saves'
);
select is(
	(select count(*) from public.trash where url = 'https://owner.test/trash'),
	0::bigint,
	'non-owner cannot read trash'
);
select throws_ok(
	$$select public.move_thread(1, 'new-threads', 'trash')$$,
	'42501',
	'Only the Applemint owner can move a thread.',
	'non-owner cannot execute a thread move'
);
select throws_ok(
	$$select * from public.get_new_threads_stats()$$,
	'42501',
	'Only the Applemint owner can read thread statistics.',
	'non-owner cannot read thread statistics'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(public.is_applemint_owner(), true, 'configured account is the Applemint owner');
select is(
	(select count(*) from public."new-threads" where url = 'https://owner.test/new'),
	1::bigint,
	'owner can read new threads'
);
select is(
	(select count(*) from public."quick-save" where url = 'https://owner.test/quick'),
	1::bigint,
	'owner can read quick saves'
);
select is(
	(select count(*) from public.trash where url = 'https://owner.test/trash'),
	1::bigint,
	'owner can read trash'
);
select lives_ok(
	$$select * from public.get_new_threads_stats()$$,
	'owner can read thread statistics'
);
select lives_ok(
	$$
		select public.move_thread(
			(select id from public."new-threads" where url = 'https://owner.test/new'),
			'new-threads',
			'quick-save'
		)
	$$,
	'owner can move a thread through the RPC'
);
select is(
	(select count(*) from public."quick-save" where url = 'https://owner.test/new'),
	1::bigint,
	'owner RPC move reaches its destination'
);
reset role;

select * from finish();
rollback;
