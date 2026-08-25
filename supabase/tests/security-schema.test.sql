-- Single-owner security boundary and schema integrity contract.
begin;

select plan(59);

select ok(
	to_regclass('public."new-threads"') is null
		and to_regclass('public."quick-save"') is null
		and to_regclass('public.trash') is null,
	'legacy thread tables are absent'
);
select ok(
	to_regprocedure('public.move_thread(bigint,text,text)') is null
		and to_regprocedure('public.bulk_move_new_threads_to_trash()') is null
		and to_regprocedure('public.list_thread_page(text,integer,timestamp with time zone,bigint,text)') is null
		and to_regprocedure('public.get_new_threads_stats(text)') is null
		and to_regprocedure('public.get_thread_storage_consistency()') is null,
	'legacy thread RPCs are absent'
);
select is(
	to_regclass('public.crawl_alert_notifications'),
	null::regclass,
	'GitHub alert delivery outbox is absent'
);
select is(
	(
		select count(*)
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'crawl_alert_incidents'
			and column_name in ('last_notification_at', 'github_issue_number', 'github_issue_url')
	),
	0::bigint,
	'GitHub alert delivery metadata is absent'
);
select ok(
	not exists (
		select 1
		from unnest(array[
			'public.threads',
			'public.thread_media_metadata',
			'public.media_enrichment_jobs',
			'public."crawl-history"',
			'public."filter-keyword"',
			'public.crawl_run_locks',
			'public.crawl_runs',
			'public.crawl_source_policies',
			'public.crawl_runtime_settings',
			'public.crawl_alert_settings',
			'public.crawl_alert_incidents',
			'public.web_push_subscriptions',
			'public.web_push_deliveries'
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
			'public.list_threads_page(text,integer,timestamp with time zone,bigint,text,text)',
			'public.get_thread_stats(text,text)',
			'public.get_normal_host_stats()',
			'public.transition_thread_state(bigint,text,text)',
			'public.bulk_move_inbox_to_trash()',
			'public.clean_trash()',
			'public.ingest_crawl_items(text,jsonb)',
			'public.claim_media_enrichment_jobs(text,integer,integer)',
			'public.complete_media_enrichment_job(bigint,uuid,jsonb)',
			'public.retry_media_enrichment_job(bigint,uuid,text,timestamp with time zone)',
			'public.fail_media_enrichment_job(bigint,uuid,text)',
			'public.acquire_crawl_lock(text,uuid,integer)',
			'public.release_crawl_lock(text,uuid)',
			'public.begin_crawl_run(text,uuid,integer)',
			'public.begin_scheduled_crawl_run(text,uuid,integer)',
			'public.heartbeat_crawl_run(bigint,uuid)',
			'public.recover_stale_crawl_runs()',
			'public.finish_crawl_run(bigint,uuid,jsonb)',
			'public.get_crawl_runs_dashboard(integer,integer)',
			'public.evaluate_crawl_alerts(timestamp with time zone)',
			'public.get_crawl_alerts_dashboard()',
			'public.upsert_web_push_subscription(text,text,text,timestamp with time zone)',
			'public.disable_web_push_subscription(text)',
			'public.acknowledge_web_push_inbox(text)',
			'public.get_web_push_subscription_status(text)',
			'public.claim_web_push_deliveries(integer,integer)',
			'public.complete_web_push_delivery(bigint,uuid)',
			'public.retry_web_push_delivery(bigint,uuid,text)',
			'public.fail_web_push_delivery(bigint,uuid,text)',
			'public.invalidate_web_push_subscription(bigint,uuid,text)',
			'public.cleanup_web_push_notifications()',
			'public.dispatch_due_web_push_notifications()'
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
			'public.threads_id_seq',
			'public."crawl-history_id_seq"',
			'public."filter-keyword_id_seq"',
			'public.crawl_runs_id_seq',
			'public.crawl_alert_incidents_id_seq',
			'public.web_push_subscriptions_id_seq',
			'public.web_push_deliveries_id_seq'
		]) as business_sequence(sequence_name)
		cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as access(privilege_name)
		where has_sequence_privilege(
			application_role.role_name,
			business_sequence.sequence_name,
			access.privilege_name
		)
	),
	'application roles have no direct business sequence access'
);
select ok(
	not exists (
		select 1
		from unnest(array['INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
		where has_table_privilege('authenticated', 'public.threads', access.privilege_name)
	),
	'authenticated cannot change threads directly'
);
select ok(
	not exists (
		select 1
		from unnest(array[
			'public."crawl-history"',
			'public."filter-keyword"',
			'public.media_enrichment_jobs',
			'public.crawl_run_locks',
			'public.crawl_runs',
			'public.crawl_alert_settings',
			'public.crawl_alert_incidents',
			'public.web_push_subscriptions',
			'public.web_push_deliveries'
		]) as internal_table(table_name)
		cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
		where has_table_privilege('authenticated', internal_table.table_name, access.privilege_name)
	),
	'authenticated cannot access crawler-internal tables directly'
);
select ok(
	has_table_privilege('service_role', 'public.threads', 'SELECT,INSERT,UPDATE,DELETE')
		and has_table_privilege(
			'service_role',
			'public.thread_media_metadata',
			'SELECT,INSERT,UPDATE,DELETE'
		)
		and has_table_privilege(
			'service_role',
			'public.media_enrichment_jobs',
			'SELECT,INSERT,UPDATE,DELETE'
		)
		and has_table_privilege('service_role', 'public."filter-keyword"', 'SELECT')
		and has_table_privilege('service_role', 'public.crawl_run_locks', 'INSERT,UPDATE,DELETE')
		and has_table_privilege('service_role', 'public.crawl_runs', 'INSERT,UPDATE,DELETE')
		and has_table_privilege('service_role', 'public.crawl_alert_incidents', 'INSERT,UPDATE,DELETE')
		and has_table_privilege(
			'service_role',
			'public.web_push_subscriptions',
			'SELECT,INSERT,UPDATE,DELETE'
		)
		and has_table_privilege(
			'service_role',
			'public.web_push_deliveries',
			'SELECT,INSERT,UPDATE,DELETE'
		),
	'service role retains required crawler table access'
);

select ok(
	not has_table_privilege('anon', 'public.threads', 'SELECT'),
	'anon cannot read threads'
);
select ok(
	has_table_privilege('authenticated', 'public.threads', 'SELECT'),
	'authenticated has the SELECT privilege required for owner RLS'
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
select ok(
	has_function_privilege('authenticated', 'public.transition_thread_state(bigint,text,text)', 'EXECUTE'),
	'authenticated can execute canonical thread transitions'
);
select ok(
	has_function_privilege('authenticated', 'public.list_threads_page(text,integer,timestamp with time zone,bigint,text,text)', 'EXECUTE'),
	'authenticated can execute canonical thread pagination'
);
select ok(
	has_function_privilege('authenticated', 'public.get_thread_stats(text,text)', 'EXECUTE'),
	'authenticated can execute canonical thread statistics'
);
select ok(
	has_function_privilege('authenticated', 'public.get_normal_host_stats()', 'EXECUTE'),
	'authenticated owner can execute normal host statistics'
);
select ok(
	has_function_privilege('authenticated', 'public.bulk_move_inbox_to_trash()', 'EXECUTE'),
	'authenticated can execute canonical bulk transitions'
);

insert into public.threads (type, url, title, host, state)
values
	('normal', 'https://owner.test/inbox', 'owner inbox', 'owner.test', 'inbox'),
	('normal', 'https://owner.test/saved', 'owner saved', 'owner.test', 'saved'),
	('normal', 'https://owner.test/trash', 'owner trash', 'owner.test', 'trash');

create temporary table owner_thread_snapshot as
select id, created_at, captured_at
from public.threads
where url = 'https://owner.test/inbox';
grant select on owner_thread_snapshot to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(public.is_applemint_owner(), false, 'another authenticated user is not the owner');
select is(
	(select count(*) from public.threads where host = 'owner.test'),
	0::bigint,
	'owner RLS hides all threads from a non-owner'
);
select throws_ok(
	$$select public.transition_thread_state(1, 'inbox', 'saved') ->> 'id'$$,
	'42501',
	'Only the Applemint owner can move a thread.',
	'non-owner cannot execute a thread transition'
);
select throws_ok(
	$$select * from public.get_thread_stats('inbox', null)$$,
	'42501',
	'Only the Applemint owner can read thread statistics.',
	'non-owner cannot read thread statistics'
);
select throws_ok(
	$$select * from public.get_normal_host_stats()$$,
	'42501',
	'Only the Applemint owner can read normal host statistics.',
	'non-owner cannot read normal host statistics'
);
select throws_ok(
	$$select public.get_crawl_alerts_dashboard()$$,
	'42501',
	'Only the Applemint owner can read crawl alerts.',
	'non-owner cannot read crawl alerts'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(public.is_applemint_owner(), true, 'configured account is the Applemint owner');
select is(
	(select count(*) from public.threads where host = 'owner.test'),
	3::bigint,
	'owner can read every thread state'
);
select lives_ok(
	$$select * from public.list_threads_page('inbox', 24, null, null, null)$$,
	'owner can list canonical threads'
);
select lives_ok(
	$$select * from public.get_thread_stats('inbox', null)$$,
	'owner can read canonical thread statistics'
);
select lives_ok(
	$$select * from public.get_normal_host_stats()$$,
	'owner can read normal host statistics'
);
select lives_ok(
	$$select public.get_crawl_alerts_dashboard()$$,
	'owner can read crawl alerts'
);
select lives_ok(
	$$
		select public.transition_thread_state(
			(select id from public.threads where url = 'https://owner.test/inbox'),
			'inbox',
			'saved'
		)
	$$,
	'owner can transition a thread through the canonical RPC'
);
select is(
	(select state from public.threads where url = 'https://owner.test/inbox'),
	'saved',
	'owner transition reaches the destination state'
);
select is(
	(select id from public.threads where url = 'https://owner.test/inbox'),
	(select id from owner_thread_snapshot),
	'owner transition preserves the thread ID'
);
select ok(
	(
		select thread.created_at = snapshot.created_at
			and thread.captured_at = snapshot.captured_at
		from public.threads as thread
		cross join owner_thread_snapshot as snapshot
		where thread.url = 'https://owner.test/inbox'
	),
	'owner transition preserves logical timestamps'
);
reset role;

select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."crawl-history"'::regclass and attname = 'url'
	),
	'crawl-history url is required'
);
select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."crawl-history"'::regclass and attname = 'crawl_source'
	),
	'crawl-history source is required'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."crawl-history"'::regclass
			and conname = 'crawl_history_url_nonempty_check'
			and contype = 'c'
	),
	'crawl-history rejects empty URLs'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."crawl-history"'::regclass
			and conname = 'crawl_history_source_check'
			and contype = 'c'
	),
	'crawl-history accepts only active sources and retained IssueLink history'
);

select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."filter-keyword"'::regclass and attname = 'value'
	),
	'filter keyword value is required'
);
select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."filter-keyword"'::regclass and attname = 'method'
	),
	'filter keyword method is required'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_value_nonempty_check'
			and contype = 'c'
	),
	'filter keywords reject empty values'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_method_nonempty_check'
			and contype = 'c'
	),
	'filter keywords reject empty methods'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_no_provider_or_retired_types'
			and contype = 'c'
	),
	'filter keywords reject provider and retired classifiers'
);
select ok(
	(
		select pg_get_constraintdef(oid) like '%media%'
			and pg_get_constraintdef(oid) like '%youtube%'
			and pg_get_constraintdef(oid) like '%imgur%'
			and pg_get_constraintdef(oid) like '%issuelink%'
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_no_provider_or_retired_types'
	),
	'filter keyword constraint reserves exact-URL provider methods'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_value_key'
			and contype = 'u'
	),
	'each filter keyword maps to one classifier'
);
select is(
	(select count(*) from public."filter-keyword" where method = 'issuelink'),
	0::bigint,
	'retired IssueLink classifier configuration is removed'
);

select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public.threads'::regclass and attname = 'url'
	),
	'thread URL is required'
);
select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public.threads'::regclass and attname = 'type'
	),
	'thread type is required'
);
select col_default_is(
	'public',
	'threads',
	'type',
	'normal',
	'thread type defaults to normal'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.threads'::regclass
			and conname = 'threads_url_nonempty_check'
			and contype = 'c'
	),
	'threads reject empty URLs'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.threads'::regclass
			and conname = 'threads_type_nonempty_check'
			and contype = 'c'
	),
	'threads reject empty types'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.threads'::regclass
			and conname = 'threads_no_retired_types'
			and contype = 'c'
	),
	'threads reject retired classifiers'
);
select ok(
	(
		select pg_get_constraintdef(oid) like '%media%'
			and pg_get_constraintdef(oid) like '%issuelink%'
			and pg_get_constraintdef(oid) not like '%youtube%'
			and pg_get_constraintdef(oid) not like '%imgur%'
		from pg_constraint
		where conrelid = 'public.threads'::regclass
			and conname = 'threads_no_retired_types'
	),
	'thread constraint activates youtube and imgur while retaining retired type bans'
);

select has_index(
	'public',
	'crawl_schedule_dispatches',
	'crawl_schedule_dispatches_run_id_idx',
	'dispatch run foreign key has a covering index'
);

select * from finish();
rollback;
