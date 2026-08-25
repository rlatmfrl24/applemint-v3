-- Retire DogDrip from every operational crawl contract. Historical run,
-- dispatch, alert, push, and crawl-history rows remain available for audit and
-- permanent deduplication, while NOT VALID constraints reject new rows.

update public.crawl_runs
set
	status = 'interrupted',
	finished_at = now(),
	duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::bigint),
	error_stage = coalesce(error_stage, 'source'),
	error_message = coalesce(error_message, 'DogDrip crawl source was retired.')
where source = 'dogdrip' and status = 'running';

delete from public.crawl_run_locks
where lock_key = 'crawl:dogdrip';

update public.crawl_schedule_dispatches
set
	state = 'expired',
	admission_reason = coalesce(admission_reason, 'source-retired'),
	resolved_at = coalesce(resolved_at, now())
where source = 'dogdrip' and state = 'queued';

update public.crawl_alert_incidents
set
	status = 'recovered',
	last_observed_at = now(),
	recovered_at = coalesce(recovered_at, now())
where source = 'dogdrip' and status = 'open';

delete from public.crawl_source_policies
where source = 'dogdrip';

alter table public.crawl_source_policies
	drop constraint crawl_source_policies_source_check;
alter table public.crawl_source_policies
	add constraint crawl_source_policies_source_check
	check (source in ('arcalive', 'battlepage', 'insagirl', 'issuelink'));

alter table public.crawl_schedule_dispatches
	drop constraint crawl_schedule_dispatches_source_check;
alter table public.crawl_schedule_dispatches
	add constraint crawl_schedule_dispatches_source_check
	check (source in ('arcalive', 'battlepage', 'insagirl', 'issuelink')) not valid;

alter table public.web_push_deliveries
	drop constraint web_push_deliveries_source_check;
alter table public.web_push_deliveries
	add constraint web_push_deliveries_source_check
	check (source in ('arcalive', 'battlepage', 'insagirl', 'issuelink')) not valid;

alter table public.crawl_runs
	drop constraint crawl_runs_source_check;
alter table public.crawl_runs
	add constraint crawl_runs_source_check
	check (source in ('arcalive', 'battlepage', 'insagirl', 'issuelink')) not valid;

alter table public.crawl_alert_incidents
	drop constraint crawl_alert_incidents_source_check;
alter table public.crawl_alert_incidents
	add constraint crawl_alert_incidents_source_check
	check (source in ('arcalive', 'battlepage', 'insagirl', 'issuelink')) not valid;

alter table public."crawl-history"
	drop constraint crawl_history_source_check;
alter table public."crawl-history"
	add constraint crawl_history_source_check
	check (crawl_source in ('arcalive', 'battlepage', 'insagirl', 'issuelink')) not valid;

-- Preserve authoritative function bodies and security attributes while
-- removing DogDrip from admission, policy, dashboard, ingest, and alert lists.
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
		'p_source not in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')',
		'p_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')'
	);
	if v_updated = v_definition then
		raise exception 'Expected _begin_crawl_run source contract was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'if p_trigger = ''scheduled'' or p_source = ''dogdrip'' then',
		'if p_trigger = ''scheduled'' then'
	);
	if v_updated = v_definition then
		raise exception 'Expected DogDrip manual cooldown condition was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'v_next_eligible_at := v_last_finished_at + make_interval(
				secs => case
					when p_trigger = ''scheduled'' then v_policy.cooldown_seconds
					else 10
				end
			);',
		'v_next_eligible_at := v_last_finished_at + make_interval(secs => v_policy.cooldown_seconds);'
	);
	if v_updated = v_definition then
		raise exception 'Expected DogDrip manual cooldown interval was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.get_crawl_runs_dashboard(integer,integer)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'source in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')',
		'source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')'
	);
	if v_updated = v_definition then
		raise exception 'Expected get_crawl_runs_dashboard source contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.update_crawl_source_policy(text,boolean,integer,timestamp with time zone)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'p_source not in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')',
		'p_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')'
	);
	if v_updated = v_definition then
		raise exception 'Expected update_crawl_source_policy source contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.ingest_crawl_items(text,jsonb)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'p_crawl_source not in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')',
		'p_crawl_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')'
	);
	if v_updated = v_definition then
		raise exception 'Expected ingest_crawl_items source contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.evaluate_crawl_alerts(timestamp with time zone)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'(''arcalive''::text), (''battlepage''), (''dogdrip''), (''insagirl''), (''issuelink'')',
		'(''arcalive''::text), (''battlepage''), (''insagirl''), (''issuelink'')'
	);
	if v_updated = v_definition then
		raise exception 'Expected evaluate_crawl_alerts source contract was not found.';
	end if;
	execute v_updated;
end;
$migration$;

revoke all on function public._begin_crawl_run(text, uuid, integer, text)
	from public, anon, authenticated, service_role;
grant execute on function public._begin_crawl_run(text, uuid, integer, text)
	to service_role;

revoke all on function public.get_crawl_runs_dashboard(integer, integer)
	from public, anon, authenticated, service_role;
grant execute on function public.get_crawl_runs_dashboard(integer, integer)
	to authenticated;

revoke all on function public.update_crawl_source_policy(
	text, boolean, integer, timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.update_crawl_source_policy(
	text, boolean, integer, timestamp with time zone
) to authenticated;

revoke all on function public.ingest_crawl_items(text, jsonb)
	from public, anon, authenticated, service_role;
grant execute on function public.ingest_crawl_items(text, jsonb)
	to service_role;

revoke all on function public.evaluate_crawl_alerts(timestamp with time zone)
	from public, anon, authenticated, service_role;
grant execute on function public.evaluate_crawl_alerts(timestamp with time zone)
	to service_role;
