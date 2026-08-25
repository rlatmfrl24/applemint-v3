-- Add DogDrip popular posts as a low-frequency pilot source. The source starts
-- disabled so the deployed adapter can be proven before scheduled dispatch is
-- enabled through the owner policy RPC.

alter table public.crawl_source_policies
	drop constraint crawl_source_policies_source_check;
alter table public.crawl_source_policies
	add constraint crawl_source_policies_source_check
	check (source in ('arcalive', 'battlepage', 'dogdrip', 'insagirl', 'issuelink'));

insert into public.crawl_source_policies (
	source,
	schedule_enabled,
	cooldown_seconds,
	recommended_cooldown_seconds,
	run_budget_seconds,
	updated_at
)
values ('dogdrip', false, 10800, 10800, 45, now())
on conflict (source) do update
set
	schedule_enabled = false,
	cooldown_seconds = excluded.cooldown_seconds,
	recommended_cooldown_seconds = excluded.recommended_cooldown_seconds,
	run_budget_seconds = excluded.run_budget_seconds,
	updated_at = excluded.updated_at;

alter table public.crawl_schedule_dispatches
	drop constraint crawl_schedule_dispatches_source_check;
alter table public.crawl_schedule_dispatches
	add constraint crawl_schedule_dispatches_source_check
	check (source in ('arcalive', 'battlepage', 'dogdrip', 'insagirl', 'issuelink'));

alter table public.web_push_deliveries
	drop constraint web_push_deliveries_source_check;
alter table public.web_push_deliveries
	add constraint web_push_deliveries_source_check
	check (source in ('arcalive', 'battlepage', 'dogdrip', 'insagirl', 'issuelink'));

alter table public.crawl_runs drop constraint crawl_runs_source_check;
alter table public.crawl_runs add constraint crawl_runs_source_check
	check (source in ('arcalive', 'battlepage', 'dogdrip', 'insagirl', 'issuelink'));

alter table public.crawl_alert_incidents
	drop constraint crawl_alert_incidents_source_check;
alter table public.crawl_alert_incidents
	add constraint crawl_alert_incidents_source_check
	check (source in ('arcalive', 'battlepage', 'dogdrip', 'insagirl', 'issuelink'));

alter table public."crawl-history" drop constraint crawl_history_source_check;
alter table public."crawl-history" add constraint crawl_history_source_check
	check (crawl_source in ('arcalive', 'battlepage', 'dogdrip', 'insagirl', 'issuelink'));

-- Preserve the authoritative function bodies and security attributes while
-- expanding only the source enumerations. Every replacement is asserted so
-- schema drift fails instead of leaving a partially activated source.
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
		'p_source not in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')'
	);
	if v_updated = v_definition then
		raise exception 'Expected _begin_crawl_run source contract was not found.';
	end if;
	execute v_updated;

	v_definition := pg_get_functiondef(
		'public.get_crawl_runs_dashboard(integer,integer)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'source in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')'
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
		'p_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'p_source not in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')'
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
		'p_crawl_source not in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'p_crawl_source not in (''arcalive'', ''battlepage'', ''dogdrip'', ''insagirl'', ''issuelink'')'
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
		'(''arcalive''::text), (''battlepage''), (''insagirl''), (''issuelink'')',
		'(''arcalive''::text), (''battlepage''), (''dogdrip''), (''insagirl''), (''issuelink'')'
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
