begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.crawl_source_registry (
	source text primary key,
	label text not null,
	active boolean not null,
	retired_at timestamp with time zone,
	created_at timestamp with time zone not null default now(),
	updated_at timestamp with time zone not null default now(),
	constraint crawl_source_registry_source_check check (
		source ~ '^[a-z][a-z0-9-]{1,63}$'
	),
	constraint crawl_source_registry_label_check check (
		octet_length(btrim(label)) between 1 and 80
	),
	constraint crawl_source_registry_retirement_check check (
		(active and retired_at is null)
		or (not active and retired_at is not null)
	)
);

insert into public.crawl_source_registry (source, label, active, retired_at)
values
	('arcalive', 'Arcalive', true, null),
	('battlepage', 'Battlepage', true, null),
	('insagirl', 'Insagirl', true, null),
	('issuelink', 'IssueLink', true, null),
	('dogdrip', 'DogDrip', false, now());

alter table public.crawl_source_registry enable row level security;

comment on table public.crawl_source_registry is
	'Service-owned lifecycle registry for installed, active, and retired crawl sources.';
comment on column public.crawl_source_registry.active is
	'Admission authority. Only active sources may start, ingest, dispatch, alert, or enqueue Push.';
comment on column public.crawl_source_registry.retired_at is
	'Required retirement timestamp for inactive sources; historical foreign-key rows remain valid.';

alter table public.crawl_source_policies
	drop constraint if exists crawl_source_policies_source_check;
alter table public.crawl_runs
	drop constraint if exists crawl_runs_source_check;
alter table public.crawl_schedule_dispatches
	drop constraint if exists crawl_schedule_dispatches_source_check;
alter table public.crawl_alert_incidents
	drop constraint if exists crawl_alert_incidents_source_check;
alter table public."crawl-history"
	drop constraint if exists crawl_history_source_check;
alter table public.web_push_deliveries
	drop constraint if exists web_push_deliveries_source_check;

alter table public.crawl_source_policies
	add constraint crawl_source_policies_source_fkey
	foreign key (source) references public.crawl_source_registry (source)
	on update restrict on delete restrict;
alter table public.crawl_runs
	add constraint crawl_runs_source_fkey
	foreign key (source) references public.crawl_source_registry (source)
	on update restrict on delete restrict;
alter table public.crawl_schedule_dispatches
	add constraint crawl_schedule_dispatches_source_fkey
	foreign key (source) references public.crawl_source_registry (source)
	on update restrict on delete restrict;
alter table public.crawl_alert_incidents
	add constraint crawl_alert_incidents_source_fkey
	foreign key (source) references public.crawl_source_registry (source)
	on update restrict on delete restrict;
alter table public."crawl-history"
	add constraint crawl_history_source_fkey
	foreign key (crawl_source) references public.crawl_source_registry (source)
	on update restrict on delete restrict;
alter table public.web_push_deliveries
	add constraint web_push_deliveries_source_fkey
	foreign key (source) references public.crawl_source_registry (source)
	on update restrict on delete restrict;

create function private.reconcile_retired_crawl_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
begin
	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(
			'applemint:crawl-source-lifecycle:' || new.source,
			0
		)
	);

	update public.crawl_runs
	set
		status = 'interrupted',
		finished_at = v_now,
		duration_ms = greatest(
			0,
			floor(extract(epoch from (v_now - started_at)) * 1000)::bigint
		),
		error_stage = coalesce(error_stage, 'source'),
		error_message = coalesce(error_message, 'Crawl source was retired.')
	where source = new.source and status = 'running';

	delete from public.crawl_run_locks
	where lock_key = 'crawl:' || new.source;

	update public.crawl_schedule_dispatches
	set
		state = 'expired',
		admission_reason = coalesce(admission_reason, 'source-retired'),
		resolved_at = coalesce(resolved_at, v_now)
	where source = new.source and state = 'queued';

	update public.crawl_alert_incidents
	set
		status = 'recovered',
		last_observed_at = v_now,
		recovered_at = coalesce(recovered_at, v_now)
	where source = new.source and status = 'open';

	return new;
end;
$$;

alter function private.reconcile_retired_crawl_source() owner to postgres;
revoke all on function private.reconcile_retired_crawl_source()
	from public, anon, authenticated, service_role;

create trigger crawl_source_registry_reconcile_after_retire
after update of active on public.crawl_source_registry
for each row
when (old.active and not new.active)
execute function private.reconcile_retired_crawl_source();

create function private.assert_active_crawl_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_source text := to_jsonb(new) ->> tg_argv[0];
begin
	if nullif(v_source, '') is null then
		raise exception using errcode = '22023', message = 'A crawl source is required.';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(
			'applemint:crawl-source-lifecycle:' || v_source,
			0
		)
	);

	if not exists (
		select 1
		from public.crawl_source_registry as registry
		where registry.source = v_source and registry.active
	) then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;

	return new;
end;
$$;

alter function private.assert_active_crawl_source() owner to postgres;
revoke all on function private.assert_active_crawl_source()
	from public, anon, authenticated, service_role;

create trigger crawl_source_policies_assert_active_source
before insert on public.crawl_source_policies
for each row execute function private.assert_active_crawl_source('source');
create trigger crawl_runs_assert_active_source
before insert on public.crawl_runs
for each row execute function private.assert_active_crawl_source('source');
create trigger crawl_schedule_dispatches_assert_active_source
before insert on public.crawl_schedule_dispatches
for each row execute function private.assert_active_crawl_source('source');
create trigger crawl_alert_incidents_assert_active_source
before insert on public.crawl_alert_incidents
for each row execute function private.assert_active_crawl_source('source');
create trigger crawl_history_assert_active_source
before insert on public."crawl-history"
for each row execute function private.assert_active_crawl_source('crawl_source');
create trigger web_push_deliveries_assert_active_source
before insert on public.web_push_deliveries
for each row execute function private.assert_active_crawl_source('source');

create or replace function public.get_active_crawl_source_registry()
returns table (source text, label text)
language sql
stable
security definer
set search_path = ''
as $$
	select registry.source, registry.label
	from public.crawl_source_registry as registry
	where registry.active
	order by registry.source;
$$;

create or replace function public.get_crawl_source_registry()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_result jsonb;
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can read the crawl source registry.';
	end if;

	select jsonb_build_object(
		'sources',
		coalesce(
			jsonb_agg(
				jsonb_build_object(
					'source', registry.source,
					'label', registry.label,
					'active', registry.active,
					'retiredAt', registry.retired_at,
					'updatedAt', registry.updated_at
				)
				order by registry.active desc, registry.source
			),
			'[]'::jsonb
		)
	)
	into v_result
	from public.crawl_source_registry as registry;

	return v_result;
end;
$$;

alter function public.get_active_crawl_source_registry() owner to postgres;
alter function public.get_crawl_source_registry() owner to postgres;
revoke all on function public.get_active_crawl_source_registry()
	from public, anon, authenticated, service_role;
grant execute on function public.get_active_crawl_source_registry()
	to service_role;
revoke all on function public.get_crawl_source_registry()
	from public, anon, authenticated, service_role;
grant execute on function public.get_crawl_source_registry()
	to authenticated;

-- Replace hard-coded active source arrays with the registry authority while
-- retaining every existing function signature and response contract.
do $migration$
declare
	v_definition text;
	v_updated text;
begin
	v_definition := pg_get_functiondef(
		'public._begin_crawl_run(text,uuid,integer,text)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'p_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'not exists (
			select 1
			from public.crawl_source_registry as registry
			where registry.source = p_source and registry.active
		)'
	);
	if v_updated = v_definition then
		raise exception 'Expected _begin_crawl_run source admission contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.ingest_crawl_items(text,jsonb)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'p_crawl_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'not exists (
			select 1
			from public.crawl_source_registry as registry
			where registry.source = p_crawl_source and registry.active
		)'
	);
	if v_updated = v_definition then
		raise exception 'Expected ingest_crawl_items source admission contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.update_crawl_source_policy(text,boolean,integer,timestamp with time zone)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'p_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'not exists (
			select 1
			from public.crawl_source_registry as registry
			where registry.source = p_source and registry.active
		)'
	);
	if v_updated = v_definition then
		raise exception 'Expected update_crawl_source_policy source admission contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public._select_due_crawl_sources(timestamp with time zone,timestamp with time zone,integer)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'from public.crawl_source_policies as policy
	left join last_runs on last_runs.source = policy.source',
		'from public.crawl_source_policies as policy
	inner join public.crawl_source_registry as registry
		on registry.source = policy.source and registry.active
	left join last_runs on last_runs.source = policy.source'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl dispatch source selection contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.get_crawl_source_policy_settings()'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'from public.crawl_source_policies as policy
	)',
		'from public.crawl_source_policies as policy
		inner join public.crawl_source_registry as registry
			on registry.source = policy.source and registry.active
	)'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl policy dashboard source contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.get_crawl_runs_dashboard(integer,integer)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'select * from effective_runs
		where source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'select run.* from effective_runs as run
		where exists (
			select 1
			from public.crawl_source_registry as registry
			where registry.source = run.source and registry.active
		)'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl dashboard recent-run source contract was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'select * from effective_runs
		where effective_status = ''running''
			and source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'select run.* from effective_runs as run
		where run.effective_status = ''running''
			and exists (
				select 1
				from public.crawl_source_registry as registry
				where registry.source = run.source and registry.active
			)'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl dashboard active-run source contract was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'from public.crawl_source_policies as policy
		), ''[]''::jsonb),',
		'from public.crawl_source_policies as policy
			inner join public.crawl_source_registry as registry
				on registry.source = policy.source and registry.active
		), ''[]''::jsonb),'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl dashboard source-summary contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.evaluate_crawl_alerts(timestamp with time zone)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'select source from (values
			(''arcalive''::text), (''battlepage''), (''insagirl''), (''issuelink'')
		) as sources(source)',
		'select registry.source
		from public.crawl_source_registry as registry
		where registry.active
		order by registry.source'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl alert source selection contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.finish_crawl_run(bigint,uuid,jsonb)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'and v_inserted_count > 0
	then',
		'and v_inserted_count > 0
		and exists (
			select 1
			from public.crawl_source_registry as registry
			where registry.source = v_source and registry.active
		)
	then'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl Push enqueue contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.claim_web_push_deliveries(integer,integer)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'end if;

	update public.web_push_subscriptions as subscription',
		'end if;

	update public.web_push_deliveries as delivery
	set
		state = ''skipped'',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = ''source-retired'',
		updated_at = v_now
	where delivery.state in (''pending'', ''retry'', ''processing'')
		and not exists (
			select 1
			from public.crawl_source_registry as registry
			where registry.source = delivery.source and registry.active
		);

	update public.web_push_subscriptions as subscription'
	);
	if v_updated = v_definition then
		raise exception 'Expected web Push retired-source cleanup point was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'inner join public.web_push_subscriptions as subscription
			on subscription.id = delivery.subscription_id
		where delivery.state in (''pending'', ''retry'')
			and delivery.available_at <= v_now',
		'inner join public.web_push_subscriptions as subscription
			on subscription.id = delivery.subscription_id
		inner join public.crawl_source_registry as registry
			on registry.source = delivery.source and registry.active
		where delivery.state in (''pending'', ''retry'')
			and delivery.available_at <= v_now'
	);
	if v_updated = v_definition then
		raise exception 'Expected web Push active-source claim contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.record_crawl_run_contract_failure(bigint,uuid,text,text)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'where run.id = p_run_id
		and run.lock_token = p_lock_token
	returning true, run.source into v_updated, v_source;',
		'where run.id = p_run_id
		and run.lock_token = p_lock_token
		and run.status <> ''interrupted''
	returning true, run.source into v_updated, v_source;'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl contract failure finalization guard was not found.';
	end if;
	execute v_updated;
end;
$migration$;

-- Internal service RPCs become owner-executed boundaries before direct table
-- privileges are removed from service_role.
alter function public.acquire_crawl_lock(text, uuid, integer) security definer;
alter function public.begin_crawl_run(text, uuid, integer) security definer;
alter function public.begin_scheduled_crawl_run(text, uuid, integer) security definer;
alter function public.heartbeat_crawl_run(bigint, uuid) security definer;
alter function public.ingest_crawl_items(text, jsonb) security definer;
alter function public.finish_crawl_run(bigint, uuid, jsonb) security definer;
alter function public.release_crawl_lock(text, uuid) security definer;
alter function public.evaluate_crawl_alerts(timestamp with time zone) security definer;
alter function public.clean_trash() security definer;
alter function public.claim_media_enrichment_jobs(text, integer, integer) security definer;
alter function public.complete_media_enrichment_job(bigint, uuid, jsonb) security definer;
alter function public.retry_media_enrichment_job(bigint, uuid, text, timestamp with time zone)
	security definer;
alter function public.fail_media_enrichment_job(bigint, uuid, text) security definer;
alter function public.claim_web_push_deliveries(integer, integer) security definer;
alter function public.complete_web_push_delivery(bigint, uuid) security definer;
alter function public.retry_web_push_delivery(bigint, uuid, text) security definer;
alter function public.fail_web_push_delivery(bigint, uuid, text) security definer;
alter function public.invalidate_web_push_subscription(bigint, uuid, text) security definer;
alter function public.claim_web_push_test_subscription(text, integer) security definer;
alter function public.invalidate_web_push_test_subscription(bigint, text) security definer;

alter function public._begin_crawl_run(text, uuid, integer, text) owner to postgres;
alter function public._crawl_next_dispatch_at(timestamp with time zone) owner to postgres;
alter function public._select_due_crawl_sources(
	timestamp with time zone,
	timestamp with time zone,
	integer
) owner to postgres;
revoke all on function public._begin_crawl_run(text, uuid, integer, text)
	from public, anon, authenticated, service_role;
revoke all on function public._crawl_next_dispatch_at(timestamp with time zone)
	from public, anon, authenticated, service_role;
revoke all on function public._select_due_crawl_sources(
	timestamp with time zone,
	timestamp with time zone,
	integer
) from public, anon, authenticated, service_role;

-- The application only reads these two legacy classifier/dedupe tables
-- directly. Every mutation and all other reads cross an explicit RPC.
revoke all privileges on all tables in schema public from service_role;
revoke all privileges on all sequences in schema public from service_role;
grant select on table public."crawl-history", public."filter-keyword" to service_role;

revoke all on table public.crawl_source_registry
	from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
	revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
	revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
	revoke execute on functions from public, anon, authenticated, service_role;

commit;
