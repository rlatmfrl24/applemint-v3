begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $migration$
declare
	v_definition text;
	v_updated text;
begin
	-- Policy settings keep their existing JSON envelope while their source rows
	-- and labels now come from the active lifecycle registry.
	v_definition := pg_get_functiondef(
		'public.get_crawl_source_policy_settings()'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'select
			policy.*,',
		'select
			policy.*,
			registry.label as source_label,'
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl policy state projection was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'from public.crawl_source_policies as policy
		where policy.source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'from public.crawl_source_policies as policy
		inner join public.crawl_source_registry as registry
			on registry.source = policy.source and registry.active'
	);
	if v_updated = v_definition then
		raise exception 'Expected fixed crawl policy source filter was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'''source'', state.source,
			''scheduleEnabled''',
		'''source'', state.source,
			''label'', state.source_label,
			''scheduleEnabled'''
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl policy source JSON projection was not found.';
	end if;
	execute v_updated;

	-- Run history remains the same API shape, with registry labels added only to
	-- source summaries. Recent and active rows follow the same active registry.
	v_definition := pg_get_functiondef(
		'public.get_crawl_runs_dashboard(integer,integer)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'recent_runs as (
		select * from effective_runs
		where source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'recent_runs as (
		select run.*
		from effective_runs as run
		inner join public.crawl_source_registry as registry
			on registry.source = run.source and registry.active'
	);
	if v_updated = v_definition then
		raise exception 'Expected fixed recent crawl run source filter was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'active_runs as (
		select * from effective_runs
		where effective_status = ''running''
			and source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'active_runs as (
		select run.*
		from effective_runs as run
		inner join public.crawl_source_registry as registry
			on registry.source = run.source and registry.active
		where run.effective_status = ''running'''
	);
	if v_updated = v_definition then
		raise exception 'Expected fixed active crawl run source filter was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'''source'', policy.source,
				''scheduleEnabled''',
		'''source'', policy.source,
				''label'', registry.label,
				''scheduleEnabled'''
	);
	if v_updated = v_definition then
		raise exception 'Expected crawl dashboard source JSON projection was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'from public.crawl_source_policies as policy
			where policy.source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'from public.crawl_source_policies as policy
			inner join public.crawl_source_registry as registry
				on registry.source = policy.source and registry.active'
	);
	if v_updated = v_definition then
		raise exception 'Expected fixed crawl dashboard summary filter was not found.';
	end if;
	execute v_updated;

	-- Alert evaluation is now registry-driven. Ordered lifecycle locks still
	-- cover every active source plus stale runs before any run mutation.
	v_definition := pg_get_functiondef(
		'public.evaluate_crawl_alerts(timestamp with time zone)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'select supported.source
		from (values
			(''arcalive''::text), (''battlepage''), (''insagirl''), (''issuelink'')
		) as supported(source)
		inner join public.crawl_source_registry as registry
			on registry.source = supported.source and registry.active
		order by supported.source',
		'select registry.source
		from public.crawl_source_registry as registry
		where registry.active
		order by registry.source'
	);
	if v_updated = v_definition then
		raise exception 'Expected fixed crawl alert evaluation source selection was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'select supported.source
		from (values
			(''arcalive''::text), (''battlepage''), (''insagirl''), (''issuelink'')
		) as supported(source)
		inner join public.crawl_source_registry as registry
			on registry.source = supported.source and registry.active
		union',
		'select registry.source
		from public.crawl_source_registry as registry
		where registry.active
		union'
	);
	if v_updated = v_definition then
		raise exception 'Expected fixed crawl alert lifecycle lock source set was not found.';
	end if;
	execute v_updated;

	-- A claimed Push delivery must still be active, but adapter capability is
	-- enforced by the application parity contract instead of a second SQL list.
	v_definition := pg_get_functiondef(
		'public.claim_web_push_deliveries(integer,integer)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'on registry.source = delivery.source and registry.active
			and delivery.source in (''arcalive'', ''battlepage'', ''insagirl'', ''issuelink'')',
		'on registry.source = delivery.source and registry.active'
	);
	if v_updated = v_definition then
		raise exception 'Expected fixed web Push adapter source filter was not found.';
	end if;
	execute v_updated;
end;
$migration$;

alter function public.get_crawl_source_policy_settings() owner to postgres;
alter function public.get_crawl_runs_dashboard(integer, integer) owner to postgres;
alter function public.evaluate_crawl_alerts(timestamp with time zone) owner to postgres;
alter function public.claim_web_push_deliveries(integer, integer) owner to postgres;

revoke all on function public.get_crawl_source_policy_settings()
	from public, anon, authenticated, service_role;
grant execute on function public.get_crawl_source_policy_settings() to authenticated;
revoke all on function public.get_crawl_runs_dashboard(integer, integer)
	from public, anon, authenticated, service_role;
grant execute on function public.get_crawl_runs_dashboard(integer, integer) to authenticated;
revoke all on function public.evaluate_crawl_alerts(timestamp with time zone)
	from public, anon, authenticated, service_role;
grant execute on function public.evaluate_crawl_alerts(timestamp with time zone) to service_role;
revoke all on function public.claim_web_push_deliveries(integer, integer)
	from public, anon, authenticated, service_role;
grant execute on function public.claim_web_push_deliveries(integer, integer) to service_role;

commit;
