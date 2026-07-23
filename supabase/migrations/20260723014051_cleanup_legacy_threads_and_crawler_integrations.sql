begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.threads, public."new-threads", public."quick-save", public.trash
	in access exclusive mode;

do $$
declare
	v_mismatch_count bigint;
	v_canonical_count bigint;
	v_legacy_count bigint;
begin
	select
		coalesce(sum(consistency.mismatch_count), 0),
		coalesce(sum(consistency.canonical_count), 0),
		coalesce(sum(consistency.legacy_count), 0)
	into v_mismatch_count, v_canonical_count, v_legacy_count
	from public.get_thread_storage_consistency() as consistency;

	if v_mismatch_count <> 0 or v_canonical_count <> v_legacy_count then
		raise exception using
			errcode = 'P0001',
			message = format(
				'Thread cleanup aborted: canonical=%s legacy=%s mismatches=%s.',
				v_canonical_count,
				v_legacy_count,
				v_mismatch_count
			);
	end if;
end;
$$;

-- Retire the original Edge Function schedules. The canonical scheduler is the
-- applemint-dispatch-due-crawl-sources / reconcile pair created later.
do $$
declare
	v_job record;
begin
	for v_job in
		select jobid
		from cron.job
		where jobname in (
			'invoke-crawl-arcalive-every-3hours',
			'invoke-crawl-battlepage-every-3hours',
			'invoke-crawl-insagirl-every-3hours',
			'invoke-crawl-issuelink-every-3hours'
		)
			or command ilike '%/functions/v1/crawl-source%'
	loop
		perform cron.unschedule(v_job.jobid);
	end loop;
end;
$$;

drop trigger sync_thread_legacy_projection on public.threads;
drop function private.sync_thread_legacy_projection();

drop function public.move_thread(bigint, text, text);
drop function public.bulk_move_new_threads_to_trash();
drop function public.list_thread_page(text, integer, timestamp with time zone, bigint, text);
drop function public.get_new_threads_stats(text);
drop function public.get_thread_storage_consistency();

drop table public."new-threads";
drop table public."quick-save";
drop table public.trash;

comment on table public.threads is 'Applemint thread source of truth.';

-- Keep in-app incident detection while removing the GitHub Issue delivery
-- outbox, delivery RPCs, and GitHub-specific incident metadata.
create or replace function public.evaluate_crawl_alerts(
	p_now timestamp with time zone default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
	v_settings public.crawl_alert_settings%rowtype;
	v_source text;
	v_incident public.crawl_alert_incidents%rowtype;
	v_signals text[];
	v_previous_signals text[];
	v_snapshot jsonb;
	v_latest_run_id bigint;
	v_parser_failure_trigger boolean;
	v_latest_parser_clean boolean;
	v_parser_drop_trigger boolean;
	v_latest_parser_ratio numeric;
	v_first_run_at timestamp with time zone;
	v_last_success_at timestamp with time zone;
	v_transport_trigger boolean;
	v_transport_recovered boolean;
	v_transport_attempted bigint;
	v_transport_failures bigint;
	v_transport_ratio numeric;
	v_open_count integer;
begin
	if p_now is null then
		raise exception using errcode = '22023', message = 'Evaluation time is required.';
	end if;

	select * into strict v_settings
	from public.crawl_alert_settings
	where id = true
	for update;

	update public.crawl_runs
	set
		status = 'interrupted',
		finished_at = stale_after,
		duration_ms = greatest(0, floor(extract(epoch from (stale_after - started_at)) * 1000)::bigint),
		error_stage = coalesce(error_stage, 'unknown'),
		error_message = coalesce(error_message, '크롤링 실행이 제한 시간 안에 종료되지 않았습니다.')
	where status = 'running' and stale_after <= p_now;

	for v_source in
		select source from (values
			('arcalive'::text), ('battlepage'), ('insagirl')
		) as sources(source)
	loop
		select * into v_incident
		from public.crawl_alert_incidents
		where source = v_source and status = 'open'
		for update;
		v_previous_signals := coalesce(v_incident.active_signals, array[]::text[]);

		select run.id into v_latest_run_id
		from public.crawl_runs as run
		where run.source = v_source and run.status <> 'running'
		order by run.started_at desc, run.id desc
		limit 1;

		select coalesce(
			count(*) = v_settings.parser_failure_streak
			and bool_and(recent.parser_failure_count > 0),
			false
		)
		into v_parser_failure_trigger
		from (
			select run.parser_failure_count
			from public.crawl_runs as run
			where run.source = v_source
				and run.status <> 'running'
				and run.attempted_count > 0
			order by run.started_at desc, run.id desc
			limit v_settings.parser_failure_streak
		) as recent;

		select coalesce(run.parser_failure_count = 0, false)
		into v_latest_parser_clean
		from public.crawl_runs as run
		where run.source = v_source
			and run.status <> 'running'
			and run.attempted_count > 0
		order by run.started_at desc, run.id desc
		limit 1;
		v_latest_parser_clean := coalesce(v_latest_parser_clean, false);

		select coalesce(
			count(*) = v_settings.parser_drop_streak
			and bool_and(recent.ratio < v_settings.parser_drop_ratio),
			false
		)
		into v_parser_drop_trigger
		from (
			select run.parser_valid_count::numeric / run.parser_minimum_count as ratio
			from public.crawl_runs as run
			where run.source = v_source
				and run.status <> 'running'
				and run.parser_minimum_count > 0
			order by run.started_at desc, run.id desc
			limit v_settings.parser_drop_streak
		) as recent;

		select run.parser_valid_count::numeric / run.parser_minimum_count
		into v_latest_parser_ratio
		from public.crawl_runs as run
		where run.source = v_source
			and run.status <> 'running'
			and run.parser_minimum_count > 0
		order by run.started_at desc, run.id desc
		limit 1;

		select min(run.started_at), max(run.finished_at) filter (
			where run.status in ('succeeded', 'partial')
		)
		into v_first_run_at, v_last_success_at
		from public.crawl_runs as run
		where run.source = v_source and run.status <> 'running';

		select
			coalesce(sum(recent.attempted_count), 0),
			coalesce(sum(recent.transport_failures), 0),
			coalesce(sum(recent.transport_failures)::numeric / nullif(sum(recent.attempted_count), 0), 0),
			coalesce(
				count(*) = v_settings.transport_window
					and sum(recent.transport_failures) >= v_settings.transport_min_failures
					and sum(recent.transport_failures)::numeric / nullif(sum(recent.attempted_count), 0)
						>= v_settings.transport_error_ratio,
				false
			)
		into v_transport_attempted, v_transport_failures, v_transport_ratio, v_transport_trigger
		from (
			select
				run.attempted_count,
				run.network_failure_count + run.timeout_failure_count as transport_failures
			from public.crawl_runs as run
			where run.source = v_source
				and run.status <> 'running'
				and run.attempted_count > 0
			order by run.started_at desc, run.id desc
			limit v_settings.transport_window
		) as recent;

		select coalesce(count(*) = 2 and bool_and(recent.transport_failures = 0), false)
		into v_transport_recovered
		from (
			select run.network_failure_count + run.timeout_failure_count as transport_failures
			from public.crawl_runs as run
			where run.source = v_source
				and run.status <> 'running'
				and run.attempted_count > 0
			order by run.started_at desc, run.id desc
			limit 2
		) as recent;

		v_signals := array[]::text[];
		if (
			'parser-failure' = any(v_previous_signals) and not v_latest_parser_clean
		) or (
			not ('parser-failure' = any(v_previous_signals)) and v_parser_failure_trigger
		) then
			v_signals := array_append(v_signals, 'parser-failure');
		end if;
		if (
			'parser-volume-drop' = any(v_previous_signals)
			and coalesce(v_latest_parser_ratio, 0) < 1
		) or (
			not ('parser-volume-drop' = any(v_previous_signals)) and v_parser_drop_trigger
		) then
			v_signals := array_append(v_signals, 'parser-volume-drop');
		end if;
		if v_first_run_at is not null
			and coalesce(v_last_success_at, v_first_run_at)
				<= p_now - make_interval(secs => v_settings.no_success_seconds)
		then
			v_signals := array_append(v_signals, 'no-recent-success');
		end if;
		if (
			'transport-error-rate' = any(v_previous_signals) and not v_transport_recovered
		) or (
			not ('transport-error-rate' = any(v_previous_signals)) and v_transport_trigger
		) then
			v_signals := array_append(v_signals, 'transport-error-rate');
		end if;

		v_snapshot := jsonb_build_object(
			'latestRunId', case when v_latest_run_id is null then null else v_latest_run_id::text end,
			'parserFailureTriggered', v_parser_failure_trigger,
			'parserValidRatio', v_latest_parser_ratio,
			'lastSuccessAt', v_last_success_at,
			'hoursSinceSuccess', case
				when coalesce(v_last_success_at, v_first_run_at) is null then null
				else round((extract(epoch from (p_now - coalesce(v_last_success_at, v_first_run_at))) / 3600)::numeric, 2)
			end,
			'transportWindow', v_settings.transport_window,
			'transportAttemptedCount', v_transport_attempted,
			'transportFailureCount', v_transport_failures,
			'transportFailureRatio', round(v_transport_ratio, 4)
		);

		if v_incident.id is null and cardinality(v_signals) > 0 then
			insert into public.crawl_alert_incidents (
				source, active_signals, opened_at, last_observed_at, snapshot
			)
			values (v_source, v_signals, p_now, p_now, v_snapshot);
		elsif v_incident.id is not null and cardinality(v_signals) = 0 then
			update public.crawl_alert_incidents
			set
				status = 'recovered',
				active_signals = v_previous_signals,
				last_observed_at = p_now,
				recovered_at = p_now,
				snapshot = v_snapshot
			where id = v_incident.id;
		elsif v_incident.id is not null then
			update public.crawl_alert_incidents
			set active_signals = v_signals, last_observed_at = p_now, snapshot = v_snapshot
			where id = v_incident.id;
		end if;
	end loop;

	update public.crawl_alert_settings set last_evaluated_at = p_now where id = true;
	select count(*) into v_open_count from public.crawl_alert_incidents where status = 'open';

	return jsonb_build_object(
		'evaluatedAt', p_now,
		'activeIncidentCount', v_open_count
	);
end;
$$;

create or replace function public.get_crawl_alerts_dashboard()
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
			message = 'Only the Applemint owner can read crawl alerts.';
	end if;

	select jsonb_build_object(
		'alerts', coalesce((
			select jsonb_agg(jsonb_build_object(
				'id', incident.id::text,
				'source', incident.source,
				'activeSignals', incident.active_signals,
				'openedAt', incident.opened_at,
				'lastObservedAt', incident.last_observed_at,
				'snapshot', incident.snapshot
			) order by incident.opened_at desc, incident.id desc)
			from public.crawl_alert_incidents as incident
			where incident.status = 'open'
		), '[]'::jsonb),
		'alertSettings', jsonb_build_object(
			'parserFailureStreak', settings.parser_failure_streak,
			'parserDropRatio', settings.parser_drop_ratio,
			'parserDropStreak', settings.parser_drop_streak,
			'noSuccessSeconds', settings.no_success_seconds,
			'transportWindow', settings.transport_window,
			'transportErrorRatio', settings.transport_error_ratio,
			'transportMinFailures', settings.transport_min_failures,
			'lastEvaluatedAt', settings.last_evaluated_at
		)
	)
	into v_result
	from public.crawl_alert_settings as settings
	where settings.id = true;

	return v_result;
end;
$$;

create or replace function public.cleanup_crawl_runs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_deleted_count bigint;
begin
	update public.crawl_runs
	set
		status = 'interrupted',
		finished_at = stale_after,
		duration_ms = greatest(0, floor(extract(epoch from (stale_after - started_at)) * 1000)::bigint),
		error_stage = coalesce(error_stage, 'unknown'),
		error_message = coalesce(error_message, '크롤링 실행이 제한 시간 안에 종료되지 않았습니다.')
	where status = 'running' and stale_after <= now();

	delete from public.crawl_alert_incidents
	where status = 'recovered' and recovered_at < now() - interval '90 days';

	delete from public.crawl_runs
	where status <> 'running' and started_at < now() - interval '90 days';

	get diagnostics v_deleted_count = row_count;
	return v_deleted_count;
end;
$$;

drop function public.get_pending_crawl_alert_notifications(integer);
drop function public.complete_crawl_alert_notification(bigint, bigint, text);
drop function public.fail_crawl_alert_notification(bigint, text);

drop table public.crawl_alert_notifications;

alter table public.crawl_alert_incidents
	drop column last_notification_at,
	drop column github_issue_number,
	drop column github_issue_url;

alter table public.crawl_alert_settings
	drop column cooldown_seconds;

revoke all on function public.evaluate_crawl_alerts(timestamp with time zone)
	from public, anon, authenticated;
grant execute on function public.evaluate_crawl_alerts(timestamp with time zone) to service_role;

revoke all on function public.get_crawl_alerts_dashboard()
	from public, anon, service_role;
grant execute on function public.get_crawl_alerts_dashboard() to authenticated;

revoke all on function public.cleanup_crawl_runs()
	from public, anon, authenticated, service_role;

commit;
