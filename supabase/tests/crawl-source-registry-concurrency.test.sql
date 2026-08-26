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
		execute 'revoke execute on function public.finish_crawl_run(bigint,uuid,jsonb) from registry_lifecycle_worker';
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
grant execute on function public.finish_crawl_run(bigint, uuid, jsonb)
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

create function private.delay_registry_expired_lease_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if old.lock_key = 'crawl:registryrace' then
		perform pg_catalog.pg_sleep(0.75);
	end if;
	return old;
end;
$$;
revoke all on function private.delay_registry_expired_lease_delete()
	from public, anon, authenticated, service_role;
create trigger zz_registry_expired_lease_delete_delay
after delete on public.crawl_run_locks
for each row execute function private.delay_registry_expired_lease_delete();

create function private.delay_registry_lifecycle_alert_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.source = 'issuelink' then
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

create function private.delay_registry_alert_stale_run_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if old.source = 'issuelink'
		and old.status = 'running'
		and new.status = 'interrupted'
	then
		perform pg_catalog.pg_sleep(0.75);
	end if;
	return new;
end;
$$;
revoke all on function private.delay_registry_alert_stale_run_update()
	from public, anon, authenticated, service_role;
create trigger zz_registry_alert_stale_run_update_delay
before update on public.crawl_runs
for each row execute function private.delay_registry_alert_stale_run_update();

create function private.delay_registry_lifecycle_run_finish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if old.source = 'registryfinishrace'
		and old.status = 'running'
		and new.status = 'partial'
	then
		perform pg_catalog.pg_sleep(0.75);
	end if;
	return new;
end;
$$;
revoke all on function private.delay_registry_lifecycle_run_finish()
	from public, anon, authenticated, service_role;
create trigger zz_registry_lifecycle_finish_delay
before update on public.crawl_runs
for each row execute function private.delay_registry_lifecycle_run_finish();

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
insert into public.crawl_run_locks (lock_key, lock_token, locked_until)
values (
	'crawl:registryrace',
	'94000000-0000-4000-8000-000000000004',
	now() - interval '1 minute'
);

select plan(26);

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
	'retirement starts while crawl admission is cleaning an expired lease'
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
	'issuelink',
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
insert into public.crawl_runs (
	source,
	lock_token,
	status,
	run_trigger,
	started_at,
	stale_after
)
values (
	'issuelink',
	'94000000-0000-4000-8000-000000000005',
	'running',
	'manual',
	now() - interval '2 hours',
	now() - interval '90 minutes'
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
			where source = 'issuelink'
			returning source
		$$
	),
	1,
	'alert source retirement starts while a stale run update is delayed'
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
	(select active = false from public.crawl_source_registry where source = 'issuelink')
		and not exists (
			select 1
			from public.crawl_alert_incidents
			where source = 'issuelink' and status = 'open'
		)
		and exists (
			select 1
			from public.crawl_alert_incidents
			where source = 'issuelink' and status = 'recovered'
		),
	'alert evaluation cannot leave an open incident after concurrent retirement'
);

select is(
	extensions.dblink_disconnect('registry_worker'),
	'OK',
	'alert-race worker connection closes'
);
select is(
	extensions.dblink_disconnect('registry_retire'),
	'OK',
	'alert-race retirement connection closes'
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
	'finalization-race worker connection opens'
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
	'finalization-race retirement connection opens'
);

insert into public.crawl_source_registry (source, label, active)
values ('registryfinishrace', 'Registry Finish Race', true);
insert into public.crawl_source_policies (
	source,
	schedule_enabled,
	cooldown_seconds,
	recommended_cooldown_seconds,
	run_budget_seconds
)
values ('registryfinishrace', false, 3600, 3600, 45);
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
	9400000000000003,
	'registryfinishrace',
	'94000000-0000-4000-8000-000000000003',
	'running',
	'scheduled',
	now() - interval '1 minute',
	now() + interval '5 minutes'
);
insert into public.crawl_run_locks (lock_key, lock_token, locked_until)
values (
	'crawl:registryfinishrace',
	'94000000-0000-4000-8000-000000000003',
	now() + interval '5 minutes'
);
insert into auth.users (id)
values ('480f5282-7933-4800-a970-d6bc8f05e8cb'::uuid)
on conflict (id) do nothing;
insert into public.web_push_subscriptions (
	id,
	user_id,
	endpoint,
	p256dh,
	auth
)
values (
	9400000000000003,
	'480f5282-7933-4800-a970-d6bc8f05e8cb',
	'https://push.test/registry-finalization-race',
	repeat('p', 32),
	'authkey3'
);

select is(
	extensions.dblink_send_query(
		'registry_worker',
		$$
			select public.finish_crawl_run(
				9400000000000003,
				'94000000-0000-4000-8000-000000000003',
				'{
					"status":"partial",
					"insertedCount":1,
					"errorStage":"ingest",
					"errorMessage":"Concurrent ingest failure."
				}'::jsonb
			)
		$$
	),
	1,
	'crawl finalization starts before retirement'
);
select pg_sleep(0.15);
select is(
	extensions.dblink_send_query(
		'registry_retire',
		$$
			update public.crawl_source_registry
			set active = false, retired_at = now(), updated_at = now()
			where source = 'registryfinishrace'
			returning source
		$$
	),
	1,
	'retirement starts while crawl finalization owns the run row'
);
select pg_sleep(0.15);
select is(
	extensions.dblink_is_busy('registry_retire'),
	1,
	'retirement waits for the racing run finalization'
);

create temporary table registry_finalization_result (result jsonb not null);
insert into registry_finalization_result (result)
select result
from extensions.dblink_get_result('registry_worker') as response(result jsonb);
insert into registry_retirement_result (source)
select source
from extensions.dblink_get_result('registry_retire') as response(source text);

select ok(
	(select active = false from public.crawl_source_registry where source = 'registryfinishrace')
		and exists (
			select 1
			from public.crawl_runs
			where source = 'registryfinishrace'
				and status = 'interrupted'
				and error_stage = 'source'
				and error_message = 'Crawl source was retired.'
		)
		and not exists (
			select 1
			from public.crawl_run_locks
			where lock_key = 'crawl:registryfinishrace'
		)
		and exists (
			select 1
			from public.web_push_deliveries
			where source = 'registryfinishrace'
				and state = 'pending'
		),
	'retirement wins partial Push finalization, replaces stale errors, and removes its lease'
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

update public.crawl_source_registry
set active = true, retired_at = null, updated_at = now()
where source = 'issuelink';
delete from public.crawl_alert_incidents
where source in ('registryrace', 'issuelink', 'registryfinishrace');
delete from public.web_push_deliveries
where source in ('registryrace', 'registryalertrace', 'registryfinishrace');
delete from public.web_push_subscriptions
where id = 9400000000000003;
delete from public.crawl_run_locks
	where lock_key in ('crawl:registryrace', 'crawl:registryalertrace', 'crawl:registryfinishrace');
delete from public.crawl_schedule_dispatches
	where source in ('registryrace', 'registryalertrace', 'registryfinishrace');
delete from public.crawl_runs
	where source in ('registryrace', 'issuelink', 'registryfinishrace');
delete from public.crawl_source_policies
	where source in ('registryrace', 'registryalertrace', 'registryfinishrace');
delete from public.crawl_source_registry
	where source in ('registryrace', 'registryalertrace', 'registryfinishrace');
update public.crawl_alert_settings set parser_failure_streak = 2 where id = true;

drop trigger zz_registry_lifecycle_run_delay on public.crawl_runs;
drop function private.delay_registry_lifecycle_run_insert();
drop trigger zz_registry_expired_lease_delete_delay on public.crawl_run_locks;
drop function private.delay_registry_expired_lease_delete();
drop trigger zz_registry_lifecycle_alert_delay on public.crawl_alert_incidents;
drop function private.delay_registry_lifecycle_alert_insert();
drop trigger zz_registry_alert_stale_run_update_delay on public.crawl_runs;
drop function private.delay_registry_alert_stale_run_update();
drop trigger zz_registry_lifecycle_finish_delay on public.crawl_runs;
drop function private.delay_registry_lifecycle_run_finish();

select * from finish();

\if :registry_dblink_preexisting
\else
drop extension dblink;
\endif
revoke execute on function public.begin_crawl_run(text, uuid, integer)
	from registry_lifecycle_worker;
revoke execute on function public.evaluate_crawl_alerts(timestamp with time zone)
	from registry_lifecycle_worker;
revoke execute on function public.finish_crawl_run(bigint, uuid, jsonb)
	from registry_lifecycle_worker;
revoke select, update on public.crawl_source_registry
	from registry_lifecycle_retire;
drop role registry_lifecycle_worker;
drop role registry_lifecycle_retire;
