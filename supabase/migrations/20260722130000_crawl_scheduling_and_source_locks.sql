create table public.crawl_source_policies (
	source text primary key,
	schedule_enabled boolean not null default true,
	cooldown_seconds integer not null default 10800,
	run_budget_seconds integer not null default 45,
	updated_at timestamp with time zone not null default now(),
	constraint crawl_source_policies_source_check
		check (source in ('arcalive', 'battlepage', 'insagirl')),
	constraint crawl_source_policies_cooldown_check
		check (cooldown_seconds between 1800 and 604800),
	constraint crawl_source_policies_budget_check
		check (run_budget_seconds between 15 and 50)
);

insert into public.crawl_source_policies (source)
values ('arcalive'), ('battlepage'), ('insagirl');

create table public.crawl_runtime_settings (
	id boolean primary key default true,
	max_concurrency integer not null default 2,
	lock_ttl_seconds integer not null default 60,
	heartbeat_interval_seconds integer not null default 15,
	updated_at timestamp with time zone not null default now(),
	constraint crawl_runtime_settings_singleton_check check (id),
	constraint crawl_runtime_settings_concurrency_check check (max_concurrency between 1 and 3),
	constraint crawl_runtime_settings_ttl_check check (lock_ttl_seconds between 30 and 300),
	constraint crawl_runtime_settings_heartbeat_check check (
		heartbeat_interval_seconds between 5 and 30
		and heartbeat_interval_seconds * 2 <= lock_ttl_seconds
	)
);

insert into public.crawl_runtime_settings (id) values (true);

alter table public.crawl_source_policies enable row level security;
alter table public.crawl_runtime_settings enable row level security;

revoke all on table public.crawl_source_policies from public, anon, authenticated;
revoke all on table public.crawl_runtime_settings from public, anon, authenticated;
grant all on table public.crawl_source_policies to service_role;
grant all on table public.crawl_runtime_settings to service_role;

alter table public.crawl_runs
	add column run_trigger text not null default 'manual',
	add column last_heartbeat_at timestamp with time zone,
	add column recovered_count integer not null default 0;

alter table public.crawl_runs
	add constraint crawl_runs_trigger_check check (run_trigger in ('manual', 'scheduled'));

alter table public.crawl_runs drop constraint crawl_runs_counts_check;
alter table public.crawl_runs add constraint crawl_runs_counts_check check (
	retry_count >= 0
	and recovered_count >= 0
	and attempted_count >= 0
	and succeeded_count >= 0
	and succeeded_count <= attempted_count
	and extracted_count >= 0
	and inserted_count >= 0
	and skipped_count >= 0
	and warning_count >= 0
	and failure_count >= 0
	and network_failure_count >= 0
	and parser_failure_count >= 0
	and timeout_failure_count >= 0
	and parser_valid_count >= 0
	and parser_minimum_count >= 0
);

create index crawl_runs_source_finished_at_idx
	on public.crawl_runs (source, finished_at desc, id desc)
	where finished_at is not null;

-- 배포 중 실행 중인 기존 global lock을 해당 소스의 lease로 보존한다.
insert into public.crawl_run_locks (lock_key, lock_token, locked_until, updated_at)
select
	'crawl:' || run.source,
	lock.lock_token,
	lock.locked_until,
	lock.updated_at
from public.crawl_run_locks as lock
inner join public.crawl_runs as run
	on run.lock_token = lock.lock_token and run.status = 'running'
where lock.lock_key = 'global-crawl'
on conflict (lock_key) do update
set
	lock_token = excluded.lock_token,
	locked_until = excluded.locked_until,
	updated_at = excluded.updated_at;

delete from public.crawl_run_locks where lock_key = 'global-crawl';

create or replace function public._begin_crawl_run(
	p_source text,
	p_lock_token uuid,
	p_ttl_seconds integer,
	p_trigger text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_policy public.crawl_source_policies%rowtype;
	v_settings public.crawl_runtime_settings%rowtype;
	v_effective_ttl integer;
	v_lock_key text;
	v_active_run_id bigint;
	v_active_count integer;
	v_last_finished_at timestamp with time zone;
	v_next_eligible_at timestamp with time zone;
	v_run_id bigint;
	v_acquired boolean;
begin
	if p_source not in ('arcalive', 'battlepage', 'insagirl') then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;
	if p_lock_token is null then
		raise exception using errcode = '22023', message = 'A crawl lock token is required.';
	end if;
	if p_ttl_seconds < 30 or p_ttl_seconds > 900 then
		raise exception using errcode = '22023', message = 'Crawl lock TTL must be between 30 and 900 seconds.';
	end if;
	if p_trigger not in ('manual', 'scheduled') then
		raise exception using errcode = '22023', message = 'Unsupported crawl run trigger.';
	end if;

	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended('applemint:crawl-admission', 0)
	);

	update public.crawl_runs
	set
		status = 'interrupted',
		finished_at = stale_after,
		duration_ms = greatest(0, floor(extract(epoch from (stale_after - started_at)) * 1000)::bigint),
		error_stage = coalesce(error_stage, 'unknown'),
		error_message = coalesce(error_message, '크롤링 실행이 제한 시간 안에 종료되지 않았습니다.')
	where status = 'running' and stale_after <= v_now;

	delete from public.crawl_run_locks
	where locked_until <= v_now
		and (lock_key = 'global-crawl' or lock_key like 'crawl:%');

	select * into strict v_policy
	from public.crawl_source_policies
	where source = p_source;
	select * into strict v_settings
	from public.crawl_runtime_settings
	where id = true;

	v_lock_key := 'crawl:' || p_source;
	v_effective_ttl := least(p_ttl_seconds, v_settings.lock_ttl_seconds);

	if p_trigger = 'scheduled' and not v_policy.schedule_enabled then
		return jsonb_build_object('acquired', false, 'reason', 'disabled');
	end if;

	select run.id into v_active_run_id
	from public.crawl_runs as run
	inner join public.crawl_run_locks as lock
		on lock.lock_key = v_lock_key
		and lock.lock_token = run.lock_token
		and lock.locked_until > v_now
	where run.status = 'running'
	order by run.started_at desc, run.id desc
	limit 1;

	if v_active_run_id is not null then
		return jsonb_build_object(
			'acquired', false,
			'reason', 'source-busy',
			'activeRunId', v_active_run_id::text
		);
	end if;

	if p_trigger = 'scheduled' then
		select max(finished_at) into v_last_finished_at
		from public.crawl_runs
		where source = p_source and status <> 'running';

		if v_last_finished_at is not null then
			v_next_eligible_at := v_last_finished_at + make_interval(secs => v_policy.cooldown_seconds);
			if v_next_eligible_at > v_now then
				return jsonb_build_object(
					'acquired', false,
					'reason', 'cooldown',
					'nextEligibleAt', v_next_eligible_at
				);
			end if;
		end if;
	end if;

	select count(*)::integer into v_active_count
	from public.crawl_run_locks
	where lock_key like 'crawl:%' and locked_until > v_now;

	if v_active_count >= v_settings.max_concurrency then
		return jsonb_build_object(
			'acquired', false,
			'reason', 'capacity',
			'activeCount', v_active_count,
			'retryAfterSeconds', 30
		);
	end if;

	insert into public.crawl_run_locks (lock_key, lock_token, locked_until, updated_at)
	values (
		v_lock_key,
		p_lock_token,
		v_now + make_interval(secs => v_effective_ttl),
		v_now
	)
	on conflict (lock_key) do update
	set
		lock_token = excluded.lock_token,
		locked_until = excluded.locked_until,
		updated_at = excluded.updated_at
	where public.crawl_run_locks.locked_until <= v_now
	returning true into v_acquired;

	if not coalesce(v_acquired, false) then
		return jsonb_build_object(
			'acquired', false,
			'reason', 'source-busy',
			'activeRunId', case when v_active_run_id is null then null else v_active_run_id::text end
		);
	end if;

	insert into public.crawl_runs (
		source,
		lock_token,
		run_trigger,
		last_heartbeat_at,
		stale_after
	)
	values (
		p_source,
		p_lock_token,
		p_trigger,
		v_now,
		v_now + make_interval(secs => v_effective_ttl)
	)
	returning id into v_run_id;

	return jsonb_build_object(
		'acquired', true,
		'runId', v_run_id::text,
		'lockKey', v_lock_key,
		'runBudgetSeconds', v_policy.run_budget_seconds,
		'lockTtlSeconds', v_effective_ttl,
		'heartbeatIntervalSeconds', v_settings.heartbeat_interval_seconds
	);
end;
$$;

create or replace function public.begin_crawl_run(
	p_source text,
	p_lock_token uuid,
	p_ttl_seconds integer default 300
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
	select public._begin_crawl_run(p_source, p_lock_token, p_ttl_seconds, 'manual');
$$;

create or replace function public.begin_scheduled_crawl_run(
	p_source text,
	p_lock_token uuid,
	p_ttl_seconds integer default 60
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
	select public._begin_crawl_run(p_source, p_lock_token, p_ttl_seconds, 'scheduled');
$$;

create or replace function public.heartbeat_crawl_run(
	p_run_id bigint,
	p_lock_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_source text;
	v_ttl_seconds integer;
	v_stale_after timestamp with time zone;
	v_renewed boolean;
begin
	select run.source into v_source
	from public.crawl_runs as run
	where run.id = p_run_id
		and run.lock_token = p_lock_token
		and run.status = 'running'
	for update;

	if v_source is null then
		return jsonb_build_object('renewed', false, 'reason', 'run-not-running');
	end if;

	select lock_ttl_seconds into strict v_ttl_seconds
	from public.crawl_runtime_settings
	where id = true;
	v_stale_after := v_now + make_interval(secs => v_ttl_seconds);

	update public.crawl_run_locks
	set locked_until = v_stale_after, updated_at = v_now
	where lock_key = 'crawl:' || v_source
		and lock_token = p_lock_token
		and locked_until > v_now
	returning true into v_renewed;

	if not coalesce(v_renewed, false) then
		return jsonb_build_object('renewed', false, 'reason', 'lease-lost');
	end if;

	update public.crawl_runs
	set last_heartbeat_at = v_now, stale_after = v_stale_after
	where id = p_run_id and lock_token = p_lock_token and status = 'running';

	return jsonb_build_object('renewed', true, 'staleAfter', v_stale_after);
end;
$$;

create or replace function public.finish_crawl_run(
	p_run_id bigint,
	p_lock_token uuid,
	p_result jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_status text;
	v_warnings jsonb;
	v_failures jsonb;
	v_parser_observations jsonb;
	v_finished_at timestamp with time zone := now();
	v_duration_ms bigint;
	v_source text;
begin
	if p_result is null or jsonb_typeof(p_result) <> 'object' then
		raise exception using errcode = '22023', message = 'Crawl run result must be a JSON object.';
	end if;
	v_status := p_result ->> 'status';
	if v_status not in ('succeeded', 'partial', 'failed') then
		raise exception using errcode = '22023', message = 'Unsupported terminal crawl run status.';
	end if;

	v_warnings := coalesce(p_result -> 'warnings', '[]'::jsonb);
	v_failures := coalesce(p_result -> 'failures', '[]'::jsonb);
	v_parser_observations := coalesce(p_result -> 'parserObservations', '[]'::jsonb);
	if jsonb_typeof(v_warnings) <> 'array'
		or jsonb_typeof(v_failures) <> 'array'
		or jsonb_typeof(v_parser_observations) <> 'array'
	then
		raise exception using errcode = '22023', message = 'Crawl run details must be JSON arrays.';
	end if;

	update public.crawl_runs
	set
		status = v_status,
		finished_at = v_finished_at,
		duration_ms = greatest(0, floor(extract(epoch from (v_finished_at - started_at)) * 1000)::bigint),
		retry_count = coalesce((p_result ->> 'retryCount')::integer, 0),
		recovered_count = coalesce((p_result ->> 'recoveredCount')::integer, 0),
		attempted_count = coalesce((p_result ->> 'attemptedCount')::integer, 0),
		succeeded_count = coalesce((p_result ->> 'succeededCount')::integer, 0),
		extracted_count = coalesce((p_result ->> 'extractedCount')::integer, 0),
		inserted_count = coalesce((p_result ->> 'insertedCount')::integer, 0),
		skipped_count = coalesce((p_result ->> 'skippedCount')::integer, 0),
		warning_count = coalesce((p_result ->> 'warningCount')::integer, 0),
		failure_count = coalesce((p_result ->> 'failureCount')::integer, 0),
		network_failure_count = coalesce((p_result ->> 'networkFailureCount')::integer, 0),
		parser_failure_count = coalesce((p_result ->> 'parserFailureCount')::integer, 0),
		timeout_failure_count = coalesce((p_result ->> 'timeoutFailureCount')::integer, 0),
		parser_valid_count = coalesce((p_result ->> 'parserValidCount')::integer, 0),
		parser_minimum_count = coalesce((p_result ->> 'parserMinimumCount')::integer, 0),
		warnings = v_warnings,
		failures = v_failures,
		parser_observations = v_parser_observations,
		error_stage = nullif(p_result ->> 'errorStage', ''),
		error_message = nullif(p_result ->> 'errorMessage', '')
	where id = p_run_id
		and lock_token = p_lock_token
		and status = 'running'
	returning duration_ms, source into v_duration_ms, v_source;

	if v_duration_ms is null then
		raise exception using errcode = 'P0002', message = 'Running crawl run was not found.';
	end if;

	delete from public.crawl_run_locks
	where lock_token = p_lock_token
		and lock_key in ('global-crawl', 'crawl:' || v_source);

	return jsonb_build_object(
		'runId', p_run_id::text,
		'status', v_status,
		'durationMs', v_duration_ms
	);
end;
$$;

create or replace function public.release_crawl_lock(
	p_lock_key text,
	p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_deleted_count integer;
begin
	delete from public.crawl_run_locks
	where lock_token = p_lock_token
		and (
			lock_key = p_lock_key
			or (p_lock_key = 'global-crawl' and lock_key like 'crawl:%')
		);
	get diagnostics v_deleted_count = row_count;
	return v_deleted_count > 0;
end;
$$;

create or replace function public.recover_stale_crawl_runs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_recovered_count bigint;
begin
	update public.crawl_runs
	set
		status = 'interrupted',
		finished_at = stale_after,
		duration_ms = greatest(0, floor(extract(epoch from (stale_after - started_at)) * 1000)::bigint),
		error_stage = coalesce(error_stage, 'unknown'),
		error_message = coalesce(error_message, '크롤링 실행이 제한 시간 안에 종료되지 않았습니다.')
	where status = 'running' and stale_after <= now();
	get diagnostics v_recovered_count = row_count;

	delete from public.crawl_run_locks
	where locked_until <= now()
		and (lock_key = 'global-crawl' or lock_key like 'crawl:%');

	return v_recovered_count;
end;
$$;

create or replace function public.get_crawl_runs_dashboard(
	p_limit integer default 20,
	p_trend_limit integer default 20
)
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
		raise exception using errcode = '42501', message = 'Only the Applemint owner can read crawl run history.';
	end if;
	if p_limit < 1 or p_limit > 50 or p_trend_limit < 1 or p_trend_limit > 50 then
		raise exception using errcode = '22023', message = 'Crawl dashboard limits must be between 1 and 50.';
	end if;

	with effective_runs as materialized (
		select
			run.*,
			case when run.status = 'running' and run.stale_after <= now() then 'interrupted' else run.status end as effective_status,
			case when run.status = 'running' and run.stale_after <= now() then run.stale_after else run.finished_at end as effective_finished_at,
			case
				when run.status = 'running' and run.stale_after <= now()
				then greatest(0, floor(extract(epoch from (run.stale_after - run.started_at)) * 1000)::bigint)
				else run.duration_ms
			end as effective_duration_ms
		from public.crawl_runs as run
	),
	recent_runs as (
		select * from effective_runs
		where source in ('arcalive', 'battlepage', 'insagirl')
		order by started_at desc, id desc
		limit p_limit
	),
	active_runs as (
		select * from effective_runs
		where effective_status = 'running'
			and source in ('arcalive', 'battlepage', 'insagirl')
		order by started_at desc, id desc
	)
	select jsonb_build_object(
		'activeRun', (
			select jsonb_build_object(
				'id', active.id::text,
				'source', active.source,
				'status', active.effective_status,
				'startedAt', active.started_at,
				'staleAfter', active.stale_after,
				'lastHeartbeatAt', active.last_heartbeat_at
			)
			from active_runs as active limit 1
		),
		'activeRuns', coalesce((
			select jsonb_agg(jsonb_build_object(
				'id', active.id::text,
				'source', active.source,
				'status', active.effective_status,
				'startedAt', active.started_at,
				'staleAfter', active.stale_after,
				'lastHeartbeatAt', active.last_heartbeat_at
			) order by active.started_at desc, active.id desc)
			from active_runs as active
		), '[]'::jsonb),
		'runtimeSettings', (
			select jsonb_build_object(
				'maxConcurrency', settings.max_concurrency,
				'lockTtlSeconds', settings.lock_ttl_seconds,
				'heartbeatIntervalSeconds', settings.heartbeat_interval_seconds
			)
			from public.crawl_runtime_settings as settings where settings.id = true
		),
		'sources', coalesce((
			select jsonb_agg(jsonb_build_object(
				'source', policy.source,
				'scheduleEnabled', policy.schedule_enabled,
				'cooldownSeconds', policy.cooldown_seconds,
				'runBudgetSeconds', policy.run_budget_seconds,
				'lastFinishedAt', (
					select max(run.effective_finished_at) from effective_runs as run
					where run.source = policy.source and run.effective_status <> 'running'
				),
				'nextEligibleAt', (
					select max(run.effective_finished_at) + make_interval(secs => policy.cooldown_seconds)
					from effective_runs as run
					where run.source = policy.source and run.effective_status <> 'running'
				),
				'lastSuccessAt', (
					select max(run.effective_finished_at) from effective_runs as run
					where run.source = policy.source and run.effective_status in ('succeeded', 'partial')
				),
				'lastFailureAt', (
					select max(run.effective_finished_at) from effective_runs as run
					where run.source = policy.source
						and (run.effective_status in ('failed', 'interrupted') or run.failure_count > 0)
				),
				'latest', (
					select jsonb_build_object(
						'id', run.id::text,
						'status', run.effective_status,
						'trigger', run.run_trigger,
						'startedAt', run.started_at,
						'durationMs', run.effective_duration_ms,
						'extractedCount', run.extracted_count,
						'insertedCount', run.inserted_count,
						'retryCount', run.retry_count,
						'recoveredCount', run.recovered_count
					) from effective_runs as run
					where run.source = policy.source
					order by run.started_at desc, run.id desc limit 1
				),
				'trend', coalesce((
					select jsonb_agg(jsonb_build_object(
						'id', trend.id::text,
						'status', trend.effective_status,
						'startedAt', trend.started_at,
						'extractedCount', trend.extracted_count,
						'parserValidCount', trend.parser_valid_count,
						'parserMinimumCount', trend.parser_minimum_count,
						'failureCount', trend.failure_count
					) order by trend.started_at asc, trend.id asc)
					from (
						select * from effective_runs as run
						where run.source = policy.source and run.effective_status <> 'running'
						order by run.started_at desc, run.id desc limit p_trend_limit
					) as trend
				), '[]'::jsonb)
			) order by policy.source)
			from public.crawl_source_policies as policy
		), '[]'::jsonb),
		'runs', coalesce((
			select jsonb_agg(jsonb_build_object(
				'id', run.id::text,
				'source', run.source,
				'status', run.effective_status,
				'trigger', run.run_trigger,
				'startedAt', run.started_at,
				'finishedAt', run.effective_finished_at,
				'durationMs', run.effective_duration_ms,
				'lastHeartbeatAt', run.last_heartbeat_at,
				'retryCount', run.retry_count,
				'recoveredCount', run.recovered_count,
				'attemptedCount', run.attempted_count,
				'succeededCount', run.succeeded_count,
				'extractedCount', run.extracted_count,
				'insertedCount', run.inserted_count,
				'skippedCount', run.skipped_count,
				'warningCount', run.warning_count,
				'failureCount', run.failure_count,
				'networkFailureCount', run.network_failure_count,
				'parserFailureCount', run.parser_failure_count,
				'timeoutFailureCount', run.timeout_failure_count,
				'parserValidCount', run.parser_valid_count,
				'parserMinimumCount', run.parser_minimum_count,
				'warnings', run.warnings,
				'failures', run.failures,
				'parserObservations', run.parser_observations,
				'errorStage', run.error_stage,
				'errorMessage', run.error_message
			) order by run.started_at desc, run.id desc)
			from recent_runs as run
		), '[]'::jsonb)
	) into v_result;

	return v_result;
end;
$$;

revoke all on function public._begin_crawl_run(text, uuid, integer, text)
	from public, anon, authenticated;
revoke all on function public.begin_scheduled_crawl_run(text, uuid, integer)
	from public, anon, authenticated;
revoke all on function public.heartbeat_crawl_run(bigint, uuid)
	from public, anon, authenticated;
revoke all on function public.recover_stale_crawl_runs()
	from public, anon, authenticated, service_role;
grant execute on function public._begin_crawl_run(text, uuid, integer, text) to service_role;
grant execute on function public.begin_scheduled_crawl_run(text, uuid, integer) to service_role;
grant execute on function public.heartbeat_crawl_run(bigint, uuid) to service_role;

do $$
declare
	v_job_id bigint;
begin
	for v_job_id in
		select jobid from cron.job where jobname = 'applemint-recover-stale-crawl-runs'
	loop
		perform cron.unschedule(v_job_id);
	end loop;

	perform cron.schedule(
		'applemint-recover-stale-crawl-runs',
		'*/5 * * * *',
		'select public.recover_stale_crawl_runs()'
	);
end;
$$;
