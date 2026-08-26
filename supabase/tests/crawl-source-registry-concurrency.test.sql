-- Cross-session source admission and retirement serialization contract.
select exists (
	select 1 from pg_extension where extname = 'dblink'
) as registry_dblink_preexisting \gset

create extension if not exists dblink with schema extensions;

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'registry_lifecycle_worker') then
		execute 'revoke execute on function public.begin_crawl_run(text,uuid,integer) from registry_lifecycle_worker';
		execute 'revoke execute on function public.evaluate_crawl_alerts(timestamp with time zone) from registry_lifecycle_worker';
		execute 'drop role registry_lifecycle_worker';
	end if;
	if exists (select 1 from pg_roles where rolname = 'registry_lifecycle_retire') then
		execute 'revoke select, update on public.crawl_source_registry from registry_lifecycle_retire';
		execute 'drop role registry_lifecycle_retire';
	end if;
end;
$$;

select replace(gen_random_uuid()::text, '-', '') as registry_worker_password \gset
select replace(gen_random_uuid()::text, '-', '') as registry_retire_password \gset

create role registry_lifecycle_worker
	login
	bypassrls
	password :'registry_worker_password';
create role registry_lifecycle_retire
	login
	bypassrls
	password :'registry_retire_password';

grant execute on function public.begin_crawl_run(text, uuid, integer)
	to registry_lifecycle_worker;
grant execute on function public.evaluate_crawl_alerts(timestamp with time zone)
	to registry_lifecycle_worker;
grant select, update on public.crawl_source_registry
	to registry_lifecycle_retire;

create function private.delay_registry_lifecycle_run_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.source = 'registryrace' then
		perform pg_catalog.pg_sleep(0.75);
	end if;
	return new;
end;
$$;
revoke all on function private.delay_registry_lifecycle_run_insert()
	from public, anon, authenticated, service_role;
create trigger zz_registry_lifecycle_run_delay
before insert on public.crawl_runs
for each row execute function private.delay_registry_lifecycle_run_insert();

create function private.delay_registry_lifecycle_alert_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.source = 'registryalertrace' then
		perform pg_catalog.pg_sleep(0.75);
	end if;
	return new;
end;
$$;
revoke all on function private.delay_registry_lifecycle_alert_insert()
	from public, anon, authenticated, service_role;
create trigger zz_registry_lifecycle_alert_delay
before insert on public.crawl_alert_incidents
for each row execute function private.delay_registry_lifecycle_alert_insert();

insert into public.crawl_source_registry (source, label, active)
values ('registryrace', 'Registry Race', true);
insert into public.crawl_source_policies (
	source,
	schedule_enabled,
	cooldown_seconds,
	recommended_cooldown_seconds,
	run_budget_seconds
)
values ('registryrace', false, 3600, 3600, 45);

select plan(18);

select is(
	extensions.dblink_connect(
		'registry_worker',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=registry_lifecycle_worker password=%s',
			:'registry_worker_password'
		)
	),
	'OK',
	'crawl lifecycle worker connection opens'
);
select is(
	extensions.dblink_connect(
		'registry_retire',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=registry_lifecycle_retire password=%s',
			:'registry_retire_password'
		)
	),
	'OK',
	'crawl lifecycle retirement connection opens'
);

select is(
	extensions.dblink_send_query(
		'registry_worker',
		$$
			select public.begin_crawl_run(
				'registryrace',
				'94000000-0000-4000-8000-000000000001',
				300
			)
		$$
	),
	1,
	'crawl admission starts before retirement'
);
select pg_sleep(0.15);
select is(
	extensions.dblink_send_query(
		'registry_retire',
		$$
			update public.crawl_source_registry
			set active = false, retired_at = now(), updated_at = now()
			where source = 'registryrace'
			returning source
		$$
	),
	1,
	'retirement starts while crawl admission is inserting its lease'
);
select pg_sleep(0.15);
select is(
	extensions.dblink_is_busy('registry_retire'),
	1,
	'retirement waits for the source lifecycle serialization boundary'
);

create temporary table registry_admission_result (result jsonb not null);
insert into registry_admission_result (result)
select result
from extensions.dblink_get_result('registry_worker') as response(result jsonb);
create temporary table registry_retirement_result (source text not null);
insert into registry_retirement_result (source)
select source
from extensions.dblink_get_result('registry_retire') as response(source text);

select is(
	(select result ->> 'acquired' from registry_admission_result),
	'true',
	'the crawl admission completes before the serialized retirement'
);
select is(
	(select active from public.crawl_source_registry where source = 'registryrace'),
	false,
	'the racing source finishes retired'
);
select ok(
	(
		select count(*) = 1
		from public.crawl_runs
		where source = 'registryrace' and status = 'interrupted'
	)
		and not exists (
			select 1 from public.crawl_run_locks where lock_key = 'crawl:registryrace'
		),
	'retirement leaves no renewable running crawl or lease after the admission race'
);
select is(
	extensions.dblink_disconnect('registry_worker'),
	'OK',
	'admission-race worker connection closes'
);
select is(
	extensions.dblink_disconnect('registry_retire'),
	'OK',
	'admission-race retirement connection closes'
);
select is(
	extensions.dblink_connect(
		'registry_worker',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=registry_lifecycle_worker password=%s',
			:'registry_worker_password'
		)
	),
	'OK',
	'alert-race worker connection opens'
);
select is(
	extensions.dblink_connect(
		'registry_retire',
		format(
			'host=supabase_db_applemint-v3 port=5432 dbname=postgres user=registry_lifecycle_retire password=%s',
			:'registry_retire_password'
		)
	),
	'OK',
	'alert-race retirement connection opens'
);

insert into public.crawl_source_registry (source, label, active)
values ('registryalertrace', 'Registry Alert Race', true);
insert into public.crawl_source_policies (
	source,
	schedule_enabled,
	cooldown_seconds,
	recommended_cooldown_seconds,
	run_budget_seconds
)
values ('registryalertrace', false, 3600, 3600, 45);
insert into public.crawl_runs (
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
	'registryalertrace',
	'94000000-0000-4000-8000-000000000002',
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

select is(
	extensions.dblink_send_query(
		'registry_worker',
		$$select public.evaluate_crawl_alerts(now())$$
	),
	1,
	'alert evaluation starts before source retirement'
);
select pg_sleep(0.2);
select is(
	extensions.dblink_send_query(
		'registry_retire',
		$$
			update public.crawl_source_registry
			set active = false, retired_at = now(), updated_at = now()
			where source = 'registryalertrace'
			returning source
		$$
	),
	1,
	'alert source retirement starts while incident insertion is delayed'
);
select pg_sleep(0.15);
select is(
	extensions.dblink_is_busy('registry_retire'),
	1,
	'alert source retirement waits for incident admission serialization'
);

create temporary table registry_alert_result (result jsonb not null);
insert into registry_alert_result (result)
select result
from extensions.dblink_get_result('registry_worker') as response(result jsonb);
insert into registry_retirement_result (source)
select source
from extensions.dblink_get_result('registry_retire') as response(source text);

select ok(
	(select active = false from public.crawl_source_registry where source = 'registryalertrace')
		and not exists (
			select 1
			from public.crawl_alert_incidents
			where source = 'registryalertrace' and status = 'open'
		)
		and exists (
			select 1
			from public.crawl_alert_incidents
			where source = 'registryalertrace' and status = 'recovered'
		),
	'alert evaluation cannot leave an open incident after concurrent retirement'
);

select is(
	extensions.dblink_disconnect('registry_worker'),
	'OK',
	'crawl lifecycle worker connection closes'
);
select is(
	extensions.dblink_disconnect('registry_retire'),
	'OK',
	'crawl lifecycle retirement connection closes'
);

delete from public.crawl_alert_incidents
where source in ('registryrace', 'registryalertrace');
delete from public.crawl_run_locks
where lock_key in ('crawl:registryrace', 'crawl:registryalertrace');
delete from public.crawl_schedule_dispatches
where source in ('registryrace', 'registryalertrace');
delete from public.crawl_runs
where source in ('registryrace', 'registryalertrace');
delete from public.crawl_source_policies
where source in ('registryrace', 'registryalertrace');
delete from public.crawl_source_registry
where source in ('registryrace', 'registryalertrace');
update public.crawl_alert_settings set parser_failure_streak = 2 where id = true;

drop trigger zz_registry_lifecycle_run_delay on public.crawl_runs;
drop function private.delay_registry_lifecycle_run_insert();
drop trigger zz_registry_lifecycle_alert_delay on public.crawl_alert_incidents;
drop function private.delay_registry_lifecycle_alert_insert();

select * from finish();

\if :registry_dblink_preexisting
\else
drop extension dblink;
\endif
revoke execute on function public.begin_crawl_run(text, uuid, integer)
	from registry_lifecycle_worker;
revoke execute on function public.evaluate_crawl_alerts(timestamp with time zone)
	from registry_lifecycle_worker;
revoke select, update on public.crawl_source_registry
	from registry_lifecycle_retire;
drop role registry_lifecycle_worker;
drop role registry_lifecycle_retire;
