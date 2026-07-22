do $$
begin
	if exists (
		select 1 from public."new-threads" where type = 'issuelink'
		union all
		select 1 from public."quick-save" where type = 'issuelink'
		union all
		select 1 from public.trash where type = 'issuelink'
		union all
		select 1 from public.crawl_runs where source = 'issuelink' and status = 'running'
		union all
		select 1 from public.crawl_alert_incidents where source = 'issuelink' and status = 'open'
	) then
		raise exception using
			errcode = '23514',
			message = 'IssueLink active data must be handled before removing the source.';
	end if;
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
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can read crawl run history.';
	end if;

	if p_limit < 1 or p_limit > 50 or p_trend_limit < 1 or p_trend_limit > 50 then
		raise exception using errcode = '22023', message = 'Crawl dashboard limits must be between 1 and 50.';
	end if;

	with effective_runs as materialized (
		select
			run.*,
			case
				when run.status = 'running' and run.stale_after <= now() then 'interrupted'
				else run.status
			end as effective_status,
			case
				when run.status = 'running' and run.stale_after <= now() then run.stale_after
				else run.finished_at
			end as effective_finished_at,
			case
				when run.status = 'running' and run.stale_after <= now() then greatest(
					0,
					floor(extract(epoch from (run.stale_after - run.started_at)) * 1000)::bigint
				)
				else run.duration_ms
			end as effective_duration_ms
		from public.crawl_runs as run
	),
	sources(source) as (
		values ('arcalive'::text), ('battlepage'), ('insagirl')
	),
	recent_runs as (
		select *
		from effective_runs
		where source in ('arcalive', 'battlepage', 'insagirl')
		order by started_at desc, id desc
		limit p_limit
	),
	active_run as (
		select *
		from effective_runs
		where effective_status = 'running'
			and source in ('arcalive', 'battlepage', 'insagirl')
		order by started_at desc, id desc
		limit 1
	)
	select jsonb_build_object(
		'activeRun', (
			select jsonb_build_object(
				'id', active.id::text,
				'source', active.source,
				'status', active.effective_status,
				'startedAt', active.started_at,
				'staleAfter', active.stale_after
			)
			from active_run as active
		),
		'sources', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'source', source_row.source,
					'lastSuccessAt', (
						select max(run.effective_finished_at)
						from effective_runs as run
						where run.source = source_row.source
							and run.effective_status in ('succeeded', 'partial')
					),
					'lastFailureAt', (
						select max(run.effective_finished_at)
						from effective_runs as run
						where run.source = source_row.source
							and (run.effective_status in ('failed', 'interrupted') or run.failure_count > 0)
					),
					'latest', (
						select jsonb_build_object(
							'id', run.id::text,
							'status', run.effective_status,
							'startedAt', run.started_at,
							'durationMs', run.effective_duration_ms,
							'extractedCount', run.extracted_count,
							'insertedCount', run.inserted_count
						)
						from effective_runs as run
						where run.source = source_row.source
						order by run.started_at desc, run.id desc
						limit 1
					),
					'trend', coalesce((
						select jsonb_agg(
							jsonb_build_object(
								'id', trend.id::text,
								'status', trend.effective_status,
								'startedAt', trend.started_at,
								'extractedCount', trend.extracted_count,
								'parserValidCount', trend.parser_valid_count,
								'parserMinimumCount', trend.parser_minimum_count,
								'failureCount', trend.failure_count
							)
							order by trend.started_at asc, trend.id asc
						)
						from (
							select *
							from effective_runs as run
							where run.source = source_row.source and run.effective_status <> 'running'
							order by run.started_at desc, run.id desc
							limit p_trend_limit
						) as trend
					), '[]'::jsonb)
				)
				order by source_row.source
			)
			from sources as source_row
		), '[]'::jsonb),
		'runs', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', run.id::text,
					'source', run.source,
					'status', run.effective_status,
					'startedAt', run.started_at,
					'finishedAt', run.effective_finished_at,
					'durationMs', run.effective_duration_ms,
					'retryCount', run.retry_count,
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
				)
				order by run.started_at desc, run.id desc
			)
			from recent_runs as run
		), '[]'::jsonb)
	)
	into v_result;

	return v_result;
end;
$$;

drop index if exists public.idx_new_threads_issuelink_category;

create or replace function public.ingest_crawl_items(
	p_crawl_source text,
	p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_result jsonb;
begin
	if p_crawl_source not in ('arcalive', 'battlepage', 'insagirl') then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;

	if p_items is null or jsonb_typeof(p_items) <> 'array' then
		raise exception using errcode = '22023', message = 'Crawl items must be a JSON array.';
	end if;

	if jsonb_array_length(p_items) > 1000 then
		raise exception using errcode = '22023', message = 'A crawl batch cannot exceed 1000 items.';
	end if;

	with normalized_payload as materialized (
		select distinct on (btrim(item ->> 'url'))
			btrim(item ->> 'url') as url,
			nullif(item ->> 'title', '') as title,
			nullif(item ->> 'description', '') as description,
			nullif(item ->> 'host', '') as host,
			case
				when coalesce(nullif(item ->> 'type', ''), 'normal') in ('media', 'youtube')
					then 'normal'
				else coalesce(nullif(item ->> 'type', ''), 'normal')
			end as type,
			case
				when jsonb_typeof(item -> 'tag') = 'array' then
					array(select jsonb_array_elements_text(item -> 'tag'))
				else null
			end as tag
		from jsonb_array_elements(p_items) as payload(item)
		where nullif(btrim(item ->> 'url'), '') is not null
		order by btrim(item ->> 'url')
	),
	claimed as (
		insert into public."crawl-history" (url, crawl_source, host)
		select url, p_crawl_source, host
		from normalized_payload
		on conflict (crawl_source, url) do nothing
		returning url
	),
	inserted as (
		insert into public."new-threads" (url, title, description, host, type, tag)
		select payload.url, payload.title, payload.description, payload.host, payload.type, payload.tag
		from normalized_payload as payload
		inner join claimed using (url)
		returning url
	),
	counts as (
		select
			(select count(*) from normalized_payload) as input_count,
			(select count(*) from inserted) as inserted_count
	)
	select jsonb_build_object(
		'insertedCount', inserted_count,
		'skippedCount', input_count - inserted_count
	)
	into v_result
	from counts;

	return coalesce(v_result, jsonb_build_object('insertedCount', 0, 'skippedCount', 0));
end;
$$;

revoke all on function public.ingest_crawl_items(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_crawl_items(text, jsonb) to service_role;

revoke all on function public.list_thread_page(text, integer, timestamp with time zone, bigint, text, text)
	from public, anon, authenticated, service_role;
drop function public.list_thread_page(text, integer, timestamp with time zone, bigint, text, text);

create function public.list_thread_page(
	p_list text,
	p_limit integer default 24,
	p_cursor_created_at timestamp with time zone default null,
	p_cursor_id bigint default null,
	p_filter_type text default null
)
returns table (
	id bigint,
	created_at timestamp with time zone,
	type text,
	url text,
	title text,
	description text,
	host text,
	tag text[],
	captured_at timestamp with time zone
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if not public.is_applemint_owner() then
		raise exception using errcode = '42501', message = 'Only the Applemint owner can list threads.';
	end if;

	if p_list is null or p_list not in ('new-threads', 'quick-save', 'trash') then
		raise exception using errcode = '22023', message = format('Unsupported thread list: %s', p_list);
	end if;

	if p_limit is null or p_limit < 1 or p_limit > 100 then
		raise exception using errcode = '22023', message = 'Thread page limit must be between 1 and 100.';
	end if;

	if (p_cursor_created_at is null) <> (p_cursor_id is null) then
		raise exception using errcode = '22023', message = 'Both cursor fields must be provided together.';
	end if;

	if p_cursor_id is not null and p_cursor_id <= 0 then
		raise exception using errcode = '22023', message = 'Thread cursor id must be positive.';
	end if;

	if p_list = 'new-threads' then
		return query
		select thread.id, thread.created_at, thread.type, thread.url, thread.title,
			thread.description, thread.host, thread.tag, thread.captured_at
		from public."new-threads" as thread
		where (p_cursor_created_at is null or (thread.created_at, thread.id) < (p_cursor_created_at, p_cursor_id))
			and (p_filter_type is null or thread.type = p_filter_type)
		order by thread.created_at desc, thread.id desc
		limit (p_limit + 1);
	elsif p_list = 'quick-save' then
		return query
		select thread.id, thread.created_at, thread.type, thread.url, thread.title,
			thread.description, thread.host, thread.tag, thread.captured_at
		from public."quick-save" as thread
		where (p_cursor_created_at is null or (thread.created_at, thread.id) < (p_cursor_created_at, p_cursor_id))
			and (p_filter_type is null or thread.type = p_filter_type)
		order by thread.created_at desc, thread.id desc
		limit (p_limit + 1);
	else
		return query
		select thread.id, thread.created_at, thread.type, thread.url, thread.title,
			thread.description, thread.host, thread.tag, thread.captured_at
		from public.trash as thread
		where (p_cursor_created_at is null or (thread.created_at, thread.id) < (p_cursor_created_at, p_cursor_id))
			and (p_filter_type is null or thread.type = p_filter_type)
		order by thread.created_at desc, thread.id desc
		limit (p_limit + 1);
	end if;
end;
$$;

revoke all on function public.list_thread_page(text, integer, timestamp with time zone, bigint, text)
	from public, anon, service_role;
grant execute on function public.list_thread_page(text, integer, timestamp with time zone, bigint, text)
	to authenticated;

revoke all on function public.get_new_threads_stats(text, text)
	from public, anon, authenticated, service_role;
drop function public.get_new_threads_stats(text, text);

create function public.get_new_threads_stats(in_filter_type text default null)
returns table (key text, label text, count bigint, total_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if not public.is_applemint_owner() then
		raise exception using errcode = '42501', message = 'Only the Applemint owner can read thread statistics.';
	end if;

	return query
	with filtered_rows as (
		select thread.type
		from public."new-threads" as thread
		where in_filter_type is null or thread.type = in_filter_type
	),
	grouped_rows as (
		select filtered_rows.type as stat_key, filtered_rows.type as stat_label, count(*)::bigint as stat_count
		from filtered_rows
		group by filtered_rows.type
	),
	total_rows as (
		select count(*)::bigint as stat_total_count from filtered_rows
	)
	select grouped_rows.stat_key, grouped_rows.stat_label, grouped_rows.stat_count, total_rows.stat_total_count
	from grouped_rows
	cross join total_rows
	order by grouped_rows.stat_count desc;
end;
$$;

revoke all on function public.get_new_threads_stats(text) from public, anon, service_role;
grant execute on function public.get_new_threads_stats(text) to authenticated;

create or replace function public.begin_crawl_run(
	p_source text,
	p_lock_token uuid,
	p_ttl_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_acquired boolean;
	v_run_id bigint;
	v_active_run_id bigint;
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

	update public.crawl_runs
	set
		status = 'interrupted',
		finished_at = stale_after,
		duration_ms = greatest(0, floor(extract(epoch from (stale_after - started_at)) * 1000)::bigint),
		error_stage = coalesce(error_stage, 'unknown'),
		error_message = coalesce(error_message, '크롤링 실행이 제한 시간 안에 종료되지 않았습니다.')
	where status = 'running' and stale_after <= now();

	insert into public.crawl_run_locks (lock_key, lock_token, locked_until, updated_at)
	values ('global-crawl', p_lock_token, now() + make_interval(secs => p_ttl_seconds), now())
	on conflict (lock_key) do update
	set lock_token = excluded.lock_token, locked_until = excluded.locked_until, updated_at = excluded.updated_at
	where public.crawl_run_locks.locked_until <= now()
	returning true into v_acquired;

	if not coalesce(v_acquired, false) then
		select run.id into v_active_run_id
		from public.crawl_runs as run
		inner join public.crawl_run_locks as lock
			on lock.lock_key = 'global-crawl' and lock.lock_token = run.lock_token
		where run.status = 'running'
		order by run.started_at desc, run.id desc
		limit 1;

		return jsonb_build_object(
			'acquired', false,
			'activeRunId', case when v_active_run_id is null then null else v_active_run_id::text end
		);
	end if;

	insert into public.crawl_runs (source, lock_token, stale_after)
	values (p_source, p_lock_token, now() + make_interval(secs => p_ttl_seconds))
	returning id into v_run_id;

	return jsonb_build_object('acquired', true, 'runId', v_run_id::text);
end;
$$;

create or replace function public.evaluate_crawl_alerts(
	p_now timestamp with time zone default now()
)
returns jsonb
language plpgsql
security invoker
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
	v_incident_id bigint;
	v_open_count integer;
	v_pending_count integer;
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
			values (v_source, v_signals, p_now, p_now, v_snapshot)
			returning id into v_incident_id;

			insert into public.crawl_alert_notifications (incident_id, event, payload, created_at)
			values (
				v_incident_id,
				'opened',
				jsonb_build_object('source', v_source, 'signals', v_signals, 'snapshot', v_snapshot, 'observedAt', p_now),
				p_now
			);
		elsif v_incident.id is not null and cardinality(v_signals) = 0 then
			update public.crawl_alert_incidents
			set
				status = 'recovered',
				active_signals = v_previous_signals,
				last_observed_at = p_now,
				recovered_at = p_now,
				snapshot = v_snapshot
			where id = v_incident.id;

			insert into public.crawl_alert_notifications (incident_id, event, payload, created_at)
			values (
				v_incident.id,
				'recovered',
				jsonb_build_object('source', v_source, 'signals', v_previous_signals, 'snapshot', v_snapshot, 'observedAt', p_now),
				p_now
			)
			on conflict (incident_id, event) where delivered_at is null do update
			set payload = excluded.payload, created_at = excluded.created_at;
		elsif v_incident.id is not null then
			update public.crawl_alert_incidents
			set active_signals = v_signals, last_observed_at = p_now, snapshot = v_snapshot
			where id = v_incident.id;

			if v_signals is distinct from v_previous_signals then
				update public.crawl_alert_notifications
				set payload = jsonb_build_object(
					'source', v_source,
					'signals', v_signals,
					'snapshot', v_snapshot,
					'observedAt', p_now
				), created_at = p_now
				where incident_id = v_incident.id and event = 'opened' and delivered_at is null;

				if not found then
					insert into public.crawl_alert_notifications (incident_id, event, payload, created_at)
					values (
						v_incident.id,
						'updated',
						jsonb_build_object('source', v_source, 'signals', v_signals, 'snapshot', v_snapshot, 'observedAt', p_now),
						p_now
					)
					on conflict (incident_id, event) where delivered_at is null do update
					set payload = excluded.payload, created_at = excluded.created_at;
				end if;
			elsif v_incident.last_notification_at is not null
				and v_incident.last_notification_at <= p_now - make_interval(secs => v_settings.cooldown_seconds)
			then
				insert into public.crawl_alert_notifications (incident_id, event, payload, created_at)
				values (
					v_incident.id,
					'reminder',
					jsonb_build_object('source', v_source, 'signals', v_signals, 'snapshot', v_snapshot, 'observedAt', p_now),
					p_now
				)
				on conflict (incident_id, event) where delivered_at is null do nothing;
			end if;
		end if;
	end loop;

	update public.crawl_alert_settings set last_evaluated_at = p_now where id = true;
	select count(*) into v_open_count from public.crawl_alert_incidents where status = 'open';
	select count(*) into v_pending_count from public.crawl_alert_notifications where delivered_at is null;

	return jsonb_build_object(
		'evaluatedAt', p_now,
		'activeIncidentCount', v_open_count,
		'pendingNotificationCount', v_pending_count
	);
end;
$$;
