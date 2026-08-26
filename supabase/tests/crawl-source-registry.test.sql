-- Crawl source lifecycle authority, historical compatibility, and least privilege.
begin;

select plan(45);

select has_table(
	'public',
	'crawl_source_registry',
	'crawl source lifecycle registry exists'
);
select ok(
	(select relrowsecurity from pg_class where oid = 'public.crawl_source_registry'::regclass),
	'crawl source registry keeps RLS enabled'
);
select is(
	(
		select jsonb_object_agg(source, jsonb_build_object('label', label, 'active', active))
		from public.crawl_source_registry
	),
	'{
		"arcalive":{"label":"Arcalive","active":true},
		"battlepage":{"label":"Battlepage","active":true},
		"dogdrip":{"label":"DogDrip","active":false},
		"insagirl":{"label":"Insagirl","active":true},
		"issuelink":{"label":"IssueLink","active":true}
	}'::jsonb,
	'active and retired sources are backfilled with canonical labels'
);
select ok(
	(
		select retired_at is not null
		from public.crawl_source_registry
		where source = 'dogdrip'
	),
	'DogDrip retains an authoritative retirement timestamp'
);
select throws_ok(
	$$
		insert into public.crawl_source_registry (source, label, active, retired_at)
		values ('invalid-active', 'Invalid', true, now())
	$$,
	'23514',
	null,
	'active sources cannot carry a retirement timestamp'
);
select throws_ok(
	$$
		insert into public.crawl_source_registry (source, label, active, retired_at)
		values ('invalid-retired', 'Invalid', false, null)
	$$,
	'23514',
	null,
	'retired sources require a retirement timestamp'
);

select is(
	(
		select count(*)
		from pg_constraint
		where conname in (
			'crawl_source_policies_source_fkey',
			'crawl_runs_source_fkey',
			'crawl_schedule_dispatches_source_fkey',
			'crawl_alert_incidents_source_fkey',
			'crawl_history_source_fkey',
			'web_push_deliveries_source_fkey'
		)
			and contype = 'f'
			and confrelid = 'public.crawl_source_registry'::regclass
			and convalidated
	),
	6::bigint,
	'every source-bearing operational and history table has a validated registry FK'
);
select is(
	(
		select count(*)
		from pg_constraint
		where conname in (
			'crawl_source_policies_source_check',
			'crawl_runs_source_check',
			'crawl_schedule_dispatches_source_check',
			'crawl_alert_incidents_source_check',
			'crawl_history_source_check',
			'web_push_deliveries_source_check'
		)
	),
	0::bigint,
	'hard-coded source array checks are removed'
);
select throws_ok(
	$$
		insert into public."crawl-history" (url, crawl_source)
		values ('https://unknown-source.test/item', 'unknown-source')
	$$,
	'22023',
	'Unsupported crawl source.',
	'unregistered sources cannot enter permanent history'
);
select throws_ok(
	$$
		insert into public."crawl-history" (url, crawl_source)
		values ('https://www.dogdrip.net/dogdrip/registry-history', 'dogdrip')
	$$,
	'22023',
	'Unsupported crawl source.',
	'retired DogDrip history remains preserved but cannot receive new rows'
);

select is(
	(
		select array_agg(table_name || ':' || privilege_type order by table_name, privilege_type)
		from information_schema.role_table_grants
		where table_schema = 'public' and grantee = 'service_role'
	),
	array['crawl-history:SELECT', 'filter-keyword:SELECT']::text[],
	'service role has exactly two direct public table read grants'
);
select is(
	(
		select count(*)
		from information_schema.role_usage_grants
		where object_schema = 'public'
			and object_type = 'SEQUENCE'
			and grantee = 'service_role'
	),
	0::bigint,
	'service role has no direct public sequence privileges'
);
select ok(
	not has_table_privilege('public', 'public.crawl_source_registry', 'SELECT')
		and not has_table_privilege('anon', 'public.crawl_source_registry', 'SELECT')
		and not has_table_privilege('authenticated', 'public.crawl_source_registry', 'SELECT')
		and not has_table_privilege('service_role', 'public.crawl_source_registry', 'SELECT'),
	'registry rows are not directly exposed through the Data API'
);
select ok(
	not exists (
		select 1
		from pg_default_acl as defaults
		cross join lateral aclexplode(defaults.defaclacl) as privilege
		where defaults.defaclrole = 'postgres'::regrole
			and defaults.defaclnamespace = 'public'::regnamespace
			and privilege.grantee in (
				0,
				'anon'::regrole,
				'authenticated'::regrole,
				'service_role'::regrole
			)
	),
	'future public objects require explicit privilege opt-in'
);

select has_function(
	'public',
	'get_active_crawl_source_registry',
	array[]::text[],
	'internal active source registry RPC exists'
);
select has_function(
	'public',
	'get_crawl_source_registry',
	array[]::text[],
	'owner registry dashboard RPC exists'
);
select ok(
	has_function_privilege('service_role', 'public.get_active_crawl_source_registry()', 'EXECUTE')
		and not has_function_privilege(
			'authenticated',
			'public.get_active_crawl_source_registry()',
			'EXECUTE'
		)
		and has_function_privilege('authenticated', 'public.get_crawl_source_registry()', 'EXECUTE')
		and not has_function_privilege('anon', 'public.get_crawl_source_registry()', 'EXECUTE'),
	'internal and owner registry RPCs have disjoint execution roles'
);

create temporary table active_registry as
select * from public.get_active_crawl_source_registry() with no data;
grant insert, select on active_registry to service_role;
set local role service_role;
insert into active_registry select * from public.get_active_crawl_source_registry();
select throws_ok(
	$$
		select public.begin_crawl_run(
			'dogdrip',
			'93000000-0000-4000-8000-000000000001',
			300
		)
	$$,
	'22023',
	'Unsupported crawl source.',
	'retired DogDrip cannot start a crawl run'
);
select throws_ok(
	$$
		select public.ingest_crawl_items(
			'dogdrip',
			'[{"url":"https://www.dogdrip.net/dogdrip/registry-ingest","type":"normal"}]'::jsonb
		)
	$$,
	'22023',
	'Unsupported crawl source.',
	'retired DogDrip cannot ingest new threads'
);
reset role;
select is(
	(select jsonb_object_agg(source, label) from active_registry),
	'{
		"arcalive":"Arcalive",
		"battlepage":"Battlepage",
		"insagirl":"Insagirl",
		"issuelink":"IssueLink"
	}'::jsonb,
	'internal registry returns only the four active adapters'
);

select throws_ok(
	$$
		insert into public.crawl_source_policies (
			source,
			schedule_enabled,
			cooldown_seconds,
			recommended_cooldown_seconds,
			run_budget_seconds
		)
		values ('dogdrip', true, 3600, 3600, 45)
	$$,
	'22023',
	'Unsupported crawl source.',
	'retired sources cannot receive new policies'
);

insert into auth.users (id)
values ('480f5282-7933-4800-a970-d6bc8f05e8cb'::uuid)
on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	jsonb_array_length(public.get_crawl_source_registry() -> 'sources'),
	5,
	'owner registry RPC includes active and retired audit entries'
);
select is(
	(
		select jsonb_object_agg(source ->> 'source', source ->> 'label')
		from jsonb_array_elements(public.get_crawl_source_policy_settings() -> 'sources') as source
	),
	'{
		"arcalive":"Arcalive",
		"battlepage":"Battlepage",
		"insagirl":"Insagirl",
		"issuelink":"IssueLink"
	}'::jsonb,
	'policy dashboard exposes active registry sources with registry labels'
);
reset role;

select ok(
	position('crawl_source_registry' in pg_get_functiondef(
		'public.get_crawl_runs_dashboard(integer,integer)'::regprocedure
	)) > 0
		and position('source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')' in pg_get_functiondef(
			'public.get_crawl_runs_dashboard(integer,integer)'::regprocedure
		)) = 0,
	'crawl run dashboard follows the active registry without a second source list'
);

select ok(
	position('applemint:crawl-source-lifecycle:' in pg_get_functiondef(
		'public._begin_crawl_run(text,uuid,integer,text)'::regprocedure
	)) > 0
		and position('applemint:crawl-source-lifecycle:' in pg_get_functiondef(
			'public._begin_crawl_run(text,uuid,integer,text)'::regprocedure
		)) < position('update public.crawl_runs' in pg_get_functiondef(
			'public._begin_crawl_run(text,uuid,integer,text)'::regprocedure
		))
		and position('applemint:crawl-source-lifecycle:' in pg_get_functiondef(
			'public._begin_crawl_run(text,uuid,integer,text)'::regprocedure
		)) < position('delete from public.crawl_run_locks' in pg_get_functiondef(
			'public._begin_crawl_run(text,uuid,integer,text)'::regprocedure
		)),
	'crawl admission takes the source lifecycle lock before run or lease mutation'
);

insert into public.crawl_source_registry (source, label, active)
values ('registryprobe', 'Registry Probe', true);
insert into public.crawl_source_policies (
	source,
	schedule_enabled,
	cooldown_seconds,
	recommended_cooldown_seconds,
	run_budget_seconds
)
values ('registryprobe', false, 3600, 3600, 45);
insert into public.crawl_runs (
	id,
	source,
	lock_token,
	status,
	run_trigger,
	started_at,
	stale_after
)
values (
	9300000000000000,
	'registryprobe',
	'93000000-0000-4000-8000-000000000003',
	'running',
	'manual',
	now(),
	now() + interval '5 minutes'
);
insert into public.crawl_run_locks (lock_key, lock_token, locked_until)
values (
	'crawl:registryprobe',
	'93000000-0000-4000-8000-000000000003',
	now() + interval '5 minutes'
);
insert into public.crawl_schedule_dispatches (scheduled_for, source)
values (date_trunc('minute', now()), 'registryprobe');
set local role authenticated;
select is(
	jsonb_array_length(public.get_crawl_source_policy_settings() -> 'sources'),
	5,
	'new active registry source enters the policy response'
);
select is(
	(
		select source ->> 'label'
		from jsonb_array_elements(public.get_crawl_source_policy_settings() -> 'sources') as source
		where source ->> 'source' = 'registryprobe'
	),
	'Registry Probe',
	'policy response takes its source label from the registry'
);
select is(
	(
		select count(*)
		from jsonb_array_elements(public.get_crawl_runs_dashboard(20, 20) -> 'sources') as source
		where source ->> 'source' = 'registryprobe'
	),
	1::bigint,
	'new active registry source enters the crawl dashboard summary'
);
select is(
	(
		select count(*)
		from jsonb_array_elements(public.get_crawl_runs_dashboard(20, 20) -> 'runs') as run
		where run ->> 'source' = 'registryprobe'
	),
	1::bigint,
	'new active registry source enters recent dashboard history'
);
select is(
	(
		select count(*)
		from jsonb_array_elements(public.get_crawl_runs_dashboard(20, 20) -> 'activeRuns') as run
		where run ->> 'source' = 'registryprobe'
	),
	1::bigint,
	'new active registry source enters dashboard active runs'
);
reset role;

insert into public.crawl_runs (
	id,
	source,
	lock_token,
	status,
	run_trigger,
	started_at,
	stale_after,
	finished_at,
	duration_ms,
	attempted_count,
	failure_count,
	parser_failure_count,
	parser_minimum_count
)
values (
	9300000000000099,
	'registryprobe',
	'93000000-0000-4000-8000-000000000004',
	'failed',
	'manual',
	now() - interval '1 hour',
	now() - interval '55 minutes',
	now() - interval '59 minutes',
	60000,
	1,
	1,
	1,
	10
);
update public.crawl_alert_settings set parser_failure_streak = 1 where id = true;
set local role service_role;
select lives_ok(
	$$select public.evaluate_crawl_alerts(now())$$,
	'alert evaluation accepts the expanded active registry'
);
reset role;
select is(
	(
		select count(*)
		from public.crawl_alert_incidents
		where source = 'registryprobe'
	),
	1::bigint,
	'new active registry source enters alert evaluation'
);

insert into public.web_push_subscriptions (
	id,
	user_id,
	endpoint,
	p256dh,
	auth
)
values (
	9300000000000099,
	'480f5282-7933-4800-a970-d6bc8f05e8cb',
	'https://push.test/active-registry-source',
	repeat('p', 32),
	'authkey1'
);
insert into public.web_push_deliveries (
	id,
	run_id,
	subscription_id,
	source,
	inserted_count
)
values (
	9300000000000099,
	9300000000000099,
	9300000000000099,
	'registryprobe',
	1
);
create temporary table active_registry_claim_count (value bigint not null);
grant insert, select on active_registry_claim_count to service_role;
set local role service_role;
insert into active_registry_claim_count
select count(*) from public.claim_web_push_deliveries(20, 120) where source = 'registryprobe';
reset role;
select is(
	(select value from active_registry_claim_count),
	1::bigint,
	'Push claim accepts a newly active registry source without a SQL source list change'
);
delete from public.web_push_deliveries where id = 9300000000000099;
delete from public.web_push_subscriptions where id = 9300000000000099;

select ok(
	(
		select pg_proc.prosecdef
			and pg_get_userbyid(pg_proc.proowner) = 'postgres'
			and pg_proc.proconfig = array['search_path=""']::text[]
		from pg_proc
		where pg_proc.oid = 'private.reconcile_retired_crawl_source()'::regprocedure
	)
		and not has_function_privilege(
			'service_role',
			'private.reconcile_retired_crawl_source()',
			'EXECUTE'
		)
		and exists (
			select 1
			from pg_trigger
			where tgrelid = 'public.crawl_source_registry'::regclass
				and tgname = 'crawl_source_registry_reconcile_on_retire'
				and not tgisinternal
		)
		and (
			select pg_proc.prosecdef
				and pg_get_userbyid(pg_proc.proowner) = 'postgres'
				and pg_proc.proconfig = array['search_path=""']::text[]
			from pg_proc
			where pg_proc.oid = 'private.assert_active_crawl_source()'::regprocedure
		)
		and not has_function_privilege(
			'service_role',
			'private.assert_active_crawl_source()',
			'EXECUTE'
		)
		and (
			select count(*) = 6
			from pg_trigger
			where tgfoid = 'private.assert_active_crawl_source()'::regprocedure
				and not tgisinternal
		),
	'active-source admission and retirement are owner-executed trigger boundaries'
);
update public.crawl_source_registry
set active = false, retired_at = now(), updated_at = now()
where source = 'registryprobe';
select ok(
	(
		select status = 'interrupted'
			and finished_at is not null
			and duration_ms is not null
			and error_stage = 'source'
			and error_message = 'Crawl source was retired.'
		from public.crawl_runs
		where id = 9300000000000000
	),
	'retiring a source immediately interrupts its running crawl'
);
select ok(
	(select count(*) = 0 from public.crawl_run_locks where lock_key = 'crawl:registryprobe')
		and public.heartbeat_crawl_run(
			9300000000000000,
			'93000000-0000-4000-8000-000000000003'
		) = '{"renewed":false,"reason":"run-not-running"}'::jsonb,
	'retiring a source removes its lease and prevents further heartbeat renewal'
);
select ok(
	(
		select state = 'expired'
			and admission_reason = 'source-retired'
			and resolved_at is not null
		from public.crawl_schedule_dispatches
		where source = 'registryprobe'
	),
	'retiring a source expires its queued scheduler dispatches'
);
select ok(
	(
		select status = 'recovered'
			and recovered_at is not null
			and last_observed_at = recovered_at
		from public.crawl_alert_incidents
		where source = 'registryprobe'
	),
	'retiring a source immediately reconciles its open alert incident'
);
set local role service_role;
select is(
	public.record_crawl_run_contract_failure(
		9300000000000000,
		'93000000-0000-4000-8000-000000000003',
		'source',
		'Late pipeline contract failure.'
	),
	false,
	'contract failure fallback treats a retirement interruption as finalized'
);
reset role;
select is(
	(
		select status || ':' || error_stage || ':' || error_message
		from public.crawl_runs
		where id = 9300000000000000
	),
	'interrupted:source:Crawl source was retired.',
	'late contract failure cannot overwrite retirement status and evidence'
);

select is(
	(
		select count(*)
		from unnest(array[
			'public.acquire_crawl_lock(text,uuid,integer)',
			'public.begin_crawl_run(text,uuid,integer)',
			'public.begin_scheduled_crawl_run(text,uuid,integer)',
			'public.heartbeat_crawl_run(bigint,uuid)',
			'public.ingest_crawl_items(text,jsonb)',
			'public.finish_crawl_run(bigint,uuid,jsonb)',
			'public.release_crawl_lock(text,uuid)',
			'public.evaluate_crawl_alerts(timestamp with time zone)',
			'public.clean_trash()',
			'public.claim_media_enrichment_jobs(text,integer,integer)',
			'public.complete_media_enrichment_job(bigint,uuid,jsonb)',
			'public.retry_media_enrichment_job(bigint,uuid,text,timestamp with time zone)',
			'public.fail_media_enrichment_job(bigint,uuid,text)',
			'public.claim_web_push_deliveries(integer,integer)',
			'public.complete_web_push_delivery(bigint,uuid)',
			'public.retry_web_push_delivery(bigint,uuid,text)',
			'public.fail_web_push_delivery(bigint,uuid,text)',
			'public.invalidate_web_push_subscription(bigint,uuid,text)',
			'public.claim_web_push_test_subscription(text,integer)',
			'public.invalidate_web_push_test_subscription(bigint,text)'
		]) as rpc(signature)
		inner join pg_proc on pg_proc.oid = rpc.signature::regprocedure
		where not pg_proc.prosecdef
			or pg_get_userbyid(pg_proc.proowner) <> 'postgres'
			or pg_proc.proconfig <> array['search_path=""']::text[]
	),
	0::bigint,
	'internal service RPCs are owner-executed with empty search paths'
);
select ok(
	not has_function_privilege(
		'service_role',
		'public._begin_crawl_run(text,uuid,integer,text)',
		'EXECUTE'
	)
		and not has_function_privilege(
			'service_role',
			'public._select_due_crawl_sources(timestamp with time zone,timestamp with time zone,integer)',
			'EXECUTE'
		),
	'internal helper functions are not direct service endpoints'
);
select ok(
	position('crawl_source_registry' in pg_get_functiondef(
		'public.update_crawl_source_policy(text,boolean,integer,timestamp with time zone)'::regprocedure
	)) > 0
		and position('registry.active' in pg_get_functiondef(
			'public.update_crawl_source_policy(text,boolean,integer,timestamp with time zone)'::regprocedure
		)) > 0
		and position('crawl_source_registry' in pg_get_functiondef(
			'public.evaluate_crawl_alerts(timestamp with time zone)'::regprocedure
		)) > 0
		and position('registry.active' in pg_get_functiondef(
			'public.evaluate_crawl_alerts(timestamp with time zone)'::regprocedure
		)) > 0
		and position('applemint:crawl-source-lifecycle:' in pg_get_functiondef(
			'public.evaluate_crawl_alerts(timestamp with time zone)'::regprocedure
		)) < position('update public.crawl_runs' in pg_get_functiondef(
			'public.evaluate_crawl_alerts(timestamp with time zone)'::regprocedure
		))
		and position('crawl_source_registry' in pg_get_functiondef(
			'public.finish_crawl_run(bigint,uuid,jsonb)'::regprocedure
		)) > 0
		and position('registry.active' in pg_get_functiondef(
			'public.finish_crawl_run(bigint,uuid,jsonb)'::regprocedure
		)) > 0
		and position('crawl_source_registry' in pg_get_functiondef(
			'public.claim_web_push_deliveries(integer,integer)'::regprocedure
		)) > 0
		and position('source-retired' in pg_get_functiondef(
			'public.claim_web_push_deliveries(integer,integer)'::regprocedure
		)) > 0
		and position('applemint:crawl-source-lifecycle:' in pg_get_functiondef(
			'public.claim_web_push_deliveries(integer,integer)'::regprocedure
		)) < position('update public.web_push_deliveries as delivery' in pg_get_functiondef(
			'public.claim_web_push_deliveries(integer,integer)'::regprocedure
		))
		and position('where registry.active' in pg_get_functiondef(
			'public.claim_web_push_deliveries(integer,integer)'::regprocedure
		)) > 0
		and position('delivery.source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')' in pg_get_functiondef(
			'public.claim_web_push_deliveries(integer,integer)'::regprocedure
		)) = 0
		and position('applemint:crawl-source-lifecycle:' in pg_get_functiondef(
			'public.dispatch_due_crawl_sources()'::regprocedure
		)) < position('for v_source in' in pg_get_functiondef(
			'public.dispatch_due_crawl_sources()'::regprocedure
		))
		and position('array_agg(due.source order by due.source)' in pg_get_functiondef(
			'public.dispatch_due_crawl_sources()'::regprocedure
		)) > 0,
	'policy, alert, finish, Push, and dispatch boundaries use the registry authority without duplicate source lists'
);

alter table public.crawl_runs disable trigger crawl_runs_assert_active_source;
insert into public.crawl_runs (
	id,
	source,
	lock_token,
	status,
	run_trigger,
	started_at,
	stale_after,
	finished_at,
	duration_ms
)
values (
	9300000000000001,
	'dogdrip',
	'93000000-0000-4000-8000-000000000002',
	'succeeded',
	'scheduled',
	now() - interval '1 minute',
	now(),
	now(),
	60000
);
alter table public.crawl_runs enable trigger crawl_runs_assert_active_source;
insert into public.web_push_subscriptions (
	id,
	user_id,
	endpoint,
	p256dh,
	auth
)
values (
	9300000000000001,
	'480f5282-7933-4800-a970-d6bc8f05e8cb',
	'https://push.test/retired-source',
	repeat('p', 32),
	'authkey1'
);
alter table public.web_push_deliveries disable trigger web_push_deliveries_assert_active_source;
insert into public.web_push_deliveries (
	id,
	run_id,
	subscription_id,
	source,
	inserted_count
)
values (
	9300000000000001,
	9300000000000001,
	9300000000000001,
	'dogdrip',
	1
);
alter table public.web_push_deliveries enable trigger web_push_deliveries_assert_active_source;
create temporary table retired_claim_count (value bigint not null);
grant insert, select on retired_claim_count to service_role;
set local role service_role;
insert into retired_claim_count
select count(*) from public.claim_web_push_deliveries(20, 120) where source = 'dogdrip';
reset role;
select is(
	(select value from retired_claim_count),
	0::bigint,
	'retired source Push deliveries cannot be claimed'
);
select is(
	(
		select state || ':' || last_error_code
		from public.web_push_deliveries
		where id = 9300000000000001
	),
	'skipped:source-retired',
	'retired source Push delivery is reconciled to skipped'
);

select * from finish();
rollback;
