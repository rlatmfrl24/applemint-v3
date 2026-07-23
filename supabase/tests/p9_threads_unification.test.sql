begin;

select plan(35);

select has_table('public', 'threads', 'threads is the canonical table');
select ok(
	to_regclass('public."new-threads"') is null
		and to_regclass('public."quick-save"') is null
		and to_regclass('public.trash') is null,
	'legacy thread tables are removed'
);
select ok(
	to_regprocedure('public.move_thread(bigint,text,text)') is null
		and to_regprocedure('public.bulk_move_new_threads_to_trash()') is null
		and to_regprocedure('public.list_thread_page(text,integer,timestamp with time zone,bigint,text)') is null
		and to_regprocedure('public.get_new_threads_stats(text)') is null
		and to_regprocedure('public.get_thread_storage_consistency()') is null,
	'legacy thread RPCs are removed'
);
select ok(
	to_regclass('public.crawl_alert_notifications') is null,
	'GitHub alert outbox is removed'
);
select ok(
	to_regprocedure('public.get_pending_crawl_alert_notifications(integer)') is null
		and to_regprocedure('public.complete_crawl_alert_notification(bigint,bigint,text)') is null
		and to_regprocedure('public.fail_crawl_alert_notification(bigint,text)') is null,
	'GitHub alert delivery RPCs are removed'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname like 'invoke-crawl-%-every-3hours'
			or command ilike '%/functions/v1/crawl-source%'
	),
	0::bigint,
	'legacy Edge Function cron jobs are removed'
);
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
select ok(
	has_function_privilege(
		'authenticated',
		'public.list_threads_page(text,integer,timestamp with time zone,bigint,text)',
		'EXECUTE'
	),
	'authenticated callers can execute the canonical list RPC'
);
select ok(
	has_function_privilege(
		'authenticated',
		'public.get_thread_stats(text,text)',
		'EXECUTE'
	),
	'authenticated callers can execute the canonical stats RPC'
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
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
	(select count(*) from public.threads where type = 'p9'),
	0::bigint,
	'non-owner cannot read canonical threads'
);
select throws_ok(
	$$update public.threads set title = 'forbidden' where type = 'p9'$$,
	'42501',
	'permission denied for table threads',
	'authenticated clients cannot update threads directly'
);
reset role;

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
select is(
	(
		select count(*)
		from pg_trigger
		where tgrelid = 'public.threads'::regclass
			and tgname = 'sync_thread_legacy_projection'
	),
	0::bigint,
	'legacy projection trigger is removed'
);
select ok(
	not exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'crawl_alert_incidents'
			and column_name in ('last_notification_at', 'github_issue_number', 'github_issue_url')
	),
	'GitHub metadata is removed from incidents'
);
select ok(
	not exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'crawl_alert_settings'
			and column_name = 'cooldown_seconds'
	),
	'GitHub reminder cooldown is removed'
);
set local role service_role;
select ok(
	public.evaluate_crawl_alerts(now()) ? 'activeIncidentCount'
		and not (public.evaluate_crawl_alerts(now()) ? 'pendingNotificationCount'),
	'alert evaluation no longer exposes delivery outbox state'
);
reset role;

select * from finish();
rollback;
