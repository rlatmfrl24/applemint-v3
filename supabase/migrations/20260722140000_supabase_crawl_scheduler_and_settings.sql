create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.crawl_source_policies
	add column recommended_cooldown_seconds integer not null default 10800;

update public.crawl_source_policies
set
	cooldown_seconds = case source
		when 'arcalive' then 7200
		when 'battlepage' then 14400
		when 'insagirl' then 10800
	end,
	recommended_cooldown_seconds = case source
		when 'arcalive' then 7200
		when 'battlepage' then 14400
		when 'insagirl' then 10800
	end,
	updated_at = now();

alter table public.crawl_source_policies
	add constraint crawl_source_policies_cooldown_minute_check
	check (cooldown_seconds % 60 = 0),
	add constraint crawl_source_policies_recommended_cooldown_check
	check (
		recommended_cooldown_seconds between 1800 and 604800
		and recommended_cooldown_seconds % 60 = 0
	);

alter table public.crawl_runtime_settings
	add column scheduler_enabled boolean not null default false;

create table public.crawl_schedule_dispatches (
	id bigint generated always as identity primary key,
	scheduled_for timestamp with time zone not null,
	source text not null,
	request_id bigint,
	state text not null default 'queued',
	http_status integer,
	admission_reason text,
	run_id bigint references public.crawl_runs(id) on delete set null,
	response_body jsonb,
	created_at timestamp with time zone not null default now(),
	resolved_at timestamp with time zone,
	constraint crawl_schedule_dispatches_source_check
		check (source in ('arcalive', 'battlepage', 'insagirl')),
	constraint crawl_schedule_dispatches_state_check
		check (state in ('queued', 'succeeded', 'skipped', 'failed', 'transport-error', 'expired')),
	constraint crawl_schedule_dispatches_http_status_check
		check (http_status is null or http_status between 100 and 599),
	constraint crawl_schedule_dispatches_unique_bucket_source unique (scheduled_for, source)
);

create index crawl_schedule_dispatches_state_created_at_idx
	on public.crawl_schedule_dispatches (state, created_at)
	where state = 'queued';

create index crawl_schedule_dispatches_created_at_idx
	on public.crawl_schedule_dispatches (created_at desc);

alter table public.crawl_schedule_dispatches enable row level security;
revoke all on table public.crawl_schedule_dispatches from public, anon, authenticated;
revoke all on sequence public.crawl_schedule_dispatches_id_seq from public, anon, authenticated;
grant all on table public.crawl_schedule_dispatches to service_role;
grant usage, select on sequence public.crawl_schedule_dispatches_id_seq to service_role;

create or replace function public._crawl_next_dispatch_at(p_value timestamp with time zone)
returns timestamp with time zone
language sql
immutable
security invoker
set search_path = ''
as $$
	select pg_catalog.to_timestamp(
		pg_catalog.ceil(extract(epoch from p_value) / 300.0) * 300.0
	);
$$;

create or replace function public.get_crawl_source_policy_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_scheduler_enabled boolean;
	v_result jsonb;
begin
	if not public.is_applemint_owner() then
		raise exception using errcode = '42501', message = 'Only the Applemint owner can read crawl source policies.';
	end if;

	select settings.scheduler_enabled into strict v_scheduler_enabled
	from public.crawl_runtime_settings as settings
	where settings.id = true;

	with effective_runs as materialized (
		select
			run.*,
			case
				when run.status = 'running' and run.stale_after <= v_now then 'interrupted'
				else run.status
			end as effective_status,
			case
				when run.status = 'running' and run.stale_after <= v_now then run.stale_after
				else run.finished_at
			end as effective_finished_at
		from public.crawl_runs as run
	),
	policy_state as (
		select
			policy.*,
			(
				select max(run.effective_finished_at)
				from effective_runs as run
				where run.source = policy.source and run.effective_status <> 'running'
			) as last_finished_at,
			(
				select run.id
				from effective_runs as run
				where run.source = policy.source and run.effective_status = 'running'
				order by run.started_at desc, run.id desc
				limit 1
			) as active_run_id
		from public.crawl_source_policies as policy
	)
	select jsonb_build_object(
		'schedulerEnabled', v_scheduler_enabled,
		'serverNow', v_now,
		'dispatcherIntervalSeconds', 300,
		'sources', coalesce(jsonb_agg(jsonb_build_object(
			'source', state.source,
			'scheduleEnabled', state.schedule_enabled,
			'cooldownSeconds', state.cooldown_seconds,
			'recommendedCooldownSeconds', state.recommended_cooldown_seconds,
			'runBudgetSeconds', state.run_budget_seconds,
			'updatedAt', state.updated_at,
			'lastFinishedAt', state.last_finished_at,
			'nextEligibleAt', case
				when state.last_finished_at is null then v_now
				else state.last_finished_at + make_interval(secs => state.cooldown_seconds)
			end,
			'nextScheduledAt', case
				when not v_scheduler_enabled or not state.schedule_enabled or state.active_run_id is not null
					then null
				else public._crawl_next_dispatch_at(greatest(
					v_now,
					coalesce(
						state.last_finished_at + make_interval(secs => state.cooldown_seconds),
						v_now
					)
				))
			end,
			'activeRunId', case when state.active_run_id is null then null else state.active_run_id::text end,
			'latest', (
				select jsonb_build_object(
					'id', run.id::text,
					'status', run.effective_status,
					'trigger', run.run_trigger,
					'startedAt', run.started_at,
					'finishedAt', run.effective_finished_at,
					'insertedCount', run.inserted_count,
					'retryCount', run.retry_count,
					'recoveredCount', run.recovered_count
				)
				from effective_runs as run
				where run.source = state.source
				order by run.started_at desc, run.id desc
				limit 1
			)
		) order by state.source), '[]'::jsonb)
	) into v_result
	from policy_state as state;

	return v_result;
end;
$$;

create or replace function public.update_crawl_source_policy(
	p_source text,
	p_schedule_enabled boolean,
	p_cooldown_seconds integer,
	p_expected_updated_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_updated boolean;
	v_settings jsonb;
begin
	if not public.is_applemint_owner() then
		raise exception using errcode = '42501', message = 'Only the Applemint owner can update crawl source policies.';
	end if;
	if p_source not in ('arcalive', 'battlepage', 'insagirl') then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;
	if p_schedule_enabled is null or p_expected_updated_at is null then
		raise exception using errcode = '22023', message = 'Crawl source policy fields are required.';
	end if;
	if p_cooldown_seconds < 1800 or p_cooldown_seconds > 604800 or p_cooldown_seconds % 60 <> 0 then
		raise exception using errcode = '22023', message = 'Crawl cooldown must be a whole minute between 30 minutes and 7 days.';
	end if;

	update public.crawl_source_policies
	set
		schedule_enabled = p_schedule_enabled,
		cooldown_seconds = p_cooldown_seconds,
		updated_at = clock_timestamp()
	where source = p_source and updated_at = p_expected_updated_at
	returning true into v_updated;

	v_settings := public.get_crawl_source_policy_settings();
	return jsonb_build_object(
		'updated', coalesce(v_updated, false),
		'reason', case when coalesce(v_updated, false) then null else 'conflict' end,
		'settings', v_settings
	);
end;
$$;

create or replace function public._select_due_crawl_sources(
	p_now timestamp with time zone,
	p_scheduled_for timestamp with time zone,
	p_limit integer
)
returns table (source text, last_finished_at timestamp with time zone)
language sql
stable
security invoker
set search_path = ''
as $$
	with last_runs as (
		select run.source, max(run.finished_at) as last_finished_at
		from public.crawl_runs as run
		where run.finished_at is not null
		group by run.source
	)
	select policy.source, last_runs.last_finished_at
	from public.crawl_source_policies as policy
	left join last_runs on last_runs.source = policy.source
	where policy.schedule_enabled
		and coalesce(
			last_runs.last_finished_at + make_interval(secs => policy.cooldown_seconds),
			'-infinity'::timestamp with time zone
		) <= p_now
		and not exists (
			select 1 from public.crawl_run_locks as lock
			where lock.lock_key = 'crawl:' || policy.source and lock.locked_until > p_now
		)
		and not exists (
			select 1 from public.crawl_schedule_dispatches as dispatch
			where dispatch.scheduled_for = p_scheduled_for and dispatch.source = policy.source
		)
	order by last_runs.last_finished_at asc nulls first, policy.source
	limit greatest(0, p_limit);
$$;

create or replace function public.dispatch_due_crawl_sources()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_scheduled_for timestamp with time zone;
	v_max_concurrency integer;
	v_active_count integer;
	v_available_slots integer;
	v_scheduler_enabled boolean;
	v_base_url text;
	v_internal_secret text;
	v_request_id bigint;
	v_source record;
	v_dispatched_count integer := 0;
begin
	perform public.recover_stale_crawl_runs();
	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended('applemint:crawl-dispatch', 0)
	);

	select settings.scheduler_enabled, settings.max_concurrency
	into strict v_scheduler_enabled, v_max_concurrency
	from public.crawl_runtime_settings as settings
	where settings.id = true;

	if not v_scheduler_enabled then
		return jsonb_build_object('status', 'disabled', 'dispatchedCount', 0);
	end if;

	select secret.decrypted_secret into v_base_url
	from vault.decrypted_secrets as secret
	where secret.name = 'crawl_app_base_url'
	order by secret.created_at desc
	limit 1;
	select secret.decrypted_secret into v_internal_secret
	from vault.decrypted_secrets as secret
	where secret.name = 'crawl_internal_secret'
	order by secret.created_at desc
	limit 1;

	v_base_url := rtrim(v_base_url, '/');
	if v_base_url is null
		or v_base_url !~ '^https?://[^[:space:]]+$'
		or v_internal_secret is null
		or octet_length(v_internal_secret) < 32
	then
		return jsonb_build_object('status', 'configuration-missing', 'dispatchedCount', 0);
	end if;

	select count(*)::integer into v_active_count
	from public.crawl_run_locks as lock
	where lock.lock_key like 'crawl:%' and lock.locked_until > v_now;
	v_available_slots := greatest(0, v_max_concurrency - v_active_count);
	if v_available_slots = 0 then
		return jsonb_build_object('status', 'capacity', 'dispatchedCount', 0);
	end if;

	v_scheduled_for := date_bin(interval '5 minutes', v_now, '2000-01-01 00:00:00+00'::timestamp with time zone);
	for v_source in
		select * from public._select_due_crawl_sources(v_now, v_scheduled_for, v_available_slots)
	loop
		select net.http_post(
			url := v_base_url || '/api/crawl/scheduled',
			headers := jsonb_build_object(
				'Content-Type', 'application/json',
				'x-applemint-internal-secret', v_internal_secret
			),
			body := jsonb_build_object('target', v_source.source),
			timeout_milliseconds := 60000
		) into v_request_id;

		insert into public.crawl_schedule_dispatches (
			scheduled_for,
			source,
			request_id
		)
		values (
			v_scheduled_for,
			v_source.source,
			v_request_id
		)
		on conflict (scheduled_for, source) do nothing;
		v_dispatched_count := v_dispatched_count + 1;
	end loop;

	return jsonb_build_object('status', 'dispatched', 'dispatchedCount', v_dispatched_count);
end;
$$;

create or replace function public.reconcile_crawl_schedule_dispatches()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_dispatch record;
	v_response record;
	v_body jsonb;
	v_state text;
	v_reason text;
	v_run_id bigint;
	v_resolved_count bigint := 0;
begin
	for v_dispatch in
		select * from public.crawl_schedule_dispatches
		where state = 'queued'
		order by created_at, id
	loop
		select response.* into v_response
		from net._http_response as response
		where response.id = v_dispatch.request_id;

		if found then
			begin
				v_body := coalesce(v_response.content, '{}')::jsonb;
			exception when others then
				v_body := jsonb_build_object('raw', v_response.content);
			end;

			v_reason := nullif(v_body ->> 'reason', '');
			v_run_id := case
				when coalesce(v_body ->> 'runId', '') ~ '^[0-9]+$' then (v_body ->> 'runId')::bigint
				else null
			end;
			if v_run_id is not null and not exists (
				select 1 from public.crawl_runs where id = v_run_id
			) then
				v_run_id := null;
			end if;
			v_state := case
				when coalesce(v_response.timed_out, false) or v_response.error_msg is not null then 'transport-error'
				when v_body ->> 'status' = 'skipped' or v_reason = 'capacity' then 'skipped'
				when v_response.status_code between 200 and 299 then 'succeeded'
				else 'failed'
			end;

			update public.crawl_schedule_dispatches
			set
				state = v_state,
				http_status = v_response.status_code,
				admission_reason = v_reason,
				run_id = v_run_id,
				response_body = v_body,
				resolved_at = now()
			where id = v_dispatch.id;
			v_resolved_count := v_resolved_count + 1;
		elsif v_dispatch.created_at <= now() - interval '2 minutes' then
			update public.crawl_schedule_dispatches
			set state = 'expired', resolved_at = now()
			where id = v_dispatch.id;
			v_resolved_count := v_resolved_count + 1;
		end if;
	end loop;

	return v_resolved_count;
end;
$$;

create or replace function public.cleanup_crawl_schedule_dispatches()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_deleted_count bigint;
begin
	delete from public.crawl_schedule_dispatches
	where created_at < now() - interval '30 days';
	get diagnostics v_deleted_count = row_count;
	return v_deleted_count;
end;
$$;

revoke all on function public._crawl_next_dispatch_at(timestamp with time zone)
	from public, anon, authenticated;
revoke all on function public.get_crawl_source_policy_settings()
	from public, anon, service_role;
revoke all on function public.update_crawl_source_policy(text, boolean, integer, timestamp with time zone)
	from public, anon, service_role;
revoke all on function public._select_due_crawl_sources(timestamp with time zone, timestamp with time zone, integer)
	from public, anon, authenticated;
revoke all on function public.dispatch_due_crawl_sources()
	from public, anon, authenticated;
revoke all on function public.reconcile_crawl_schedule_dispatches()
	from public, anon, authenticated;
revoke all on function public.cleanup_crawl_schedule_dispatches()
	from public, anon, authenticated, service_role;

grant execute on function public.get_crawl_source_policy_settings() to authenticated;
grant execute on function public.update_crawl_source_policy(text, boolean, integer, timestamp with time zone)
	to authenticated;
grant execute on function public.dispatch_due_crawl_sources() to service_role;
grant execute on function public.reconcile_crawl_schedule_dispatches() to service_role;

do $$
declare
	v_job_id bigint;
begin
	for v_job_id in
		select jobid from cron.job
		where jobname in (
			'applemint-dispatch-due-crawl-sources',
			'applemint-reconcile-crawl-dispatches',
			'applemint-clean-crawl-dispatches'
		)
	loop
		perform cron.unschedule(v_job_id);
	end loop;

	perform cron.schedule(
		'applemint-dispatch-due-crawl-sources',
		'*/5 * * * *',
		'select public.dispatch_due_crawl_sources()'
	);
	perform cron.schedule(
		'applemint-reconcile-crawl-dispatches',
		'* * * * *',
		'select public.reconcile_crawl_schedule_dispatches()'
	);
	perform cron.schedule(
		'applemint-clean-crawl-dispatches',
		'35 18 * * *',
		'select public.cleanup_crawl_schedule_dispatches()'
	);
end;
$$;
