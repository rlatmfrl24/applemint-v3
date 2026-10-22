select exists(select 1 from pg_extension where extname='dblink') as schedule_dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as schedule_test_password \gset
create role health_schedule_login login password :'schedule_test_password';
grant authenticated to health_schedule_login;
grant execute on function public.enqueue_bookmark_health_daily() to health_schedule_login;
create temporary table schedule_original_settings as select health_auto_enabled,health_daily_limit from public.bookmark_settings;
update public.bookmark_settings set health_auto_enabled=true,health_daily_limit=1;
insert into public.bookmarks(id,url,url_key,saved_at) values('bbbbbbbb-9910-4000-8000-000000000001','https://health-schedule-concurrent.example/1','https://health-schedule-concurrent.example/1','1900-01-01');
select plan(4);
select extensions.dblink_connect('schedule_a',format('host=%s port=5432 dbname=postgres user=health_schedule_login password=%s',host(inet_server_addr()),:'schedule_test_password'));
select extensions.dblink_connect('schedule_b',format('host=%s port=5432 dbname=postgres user=health_schedule_login password=%s',host(inet_server_addr()),:'schedule_test_password'));
select extensions.dblink_exec('schedule_a',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_send_query('schedule_a',$q$with delay as materialized(select pg_sleep(0.2)) select public.bookmark_command('start','{"kind":"check","scope":"selected","ids":["bbbbbbbb-9910-4000-8000-000000000001"]}') from delay$q$);
select extensions.dblink_send_query('schedule_b',$q$with delay as materialized(select pg_sleep(0.2)) select public.enqueue_bookmark_health_daily() from delay$q$);
create temporary table schedule_manual(result jsonb);
insert into schedule_manual select * from extensions.dblink_get_result('schedule_a') as r(result jsonb);
select * from extensions.dblink_get_result('schedule_b') as r(result uuid);
select is((select count(*) from public.bookmark_job_items where bookmark_id='bbbbbbbb-9910-4000-8000-000000000001'),1::bigint,'automatic/manual race admits one page item');
select ok((select (result->>'queuedCount')::int+(result->>'reusedCount')::int=1 from schedule_manual),'manual start accounts for the exact requested scope');
select ok(not exists(select 1 from public.bookmark_jobs j where j.scope->>'origin'='manual' and j.total=0),'all-reused race creates no empty job');
insert into public.bookmark_jobs(id,kind) values('aaaaaaaa-9910-4000-8000-000000000002','recommend');
select is(public.bookmark_worker_claim()->'job'->>'id','aaaaaaaa-9910-4000-8000-000000000002','save recommendation has priority over automatic checking');
select extensions.dblink_disconnect('schedule_a');select extensions.dblink_disconnect('schedule_b');
create temporary table schedule_job_ids as select job_id id from public.bookmark_job_items where bookmark_id='bbbbbbbb-9910-4000-8000-000000000001';
delete from public.bookmark_job_items where bookmark_id='bbbbbbbb-9910-4000-8000-000000000001';
delete from public.bookmarks where id='bbbbbbbb-9910-4000-8000-000000000001';
delete from public.bookmark_jobs where id in(select id from schedule_job_ids) or id='aaaaaaaa-9910-4000-8000-000000000002';
update public.bookmark_settings set health_auto_enabled=s.health_auto_enabled,health_daily_limit=s.health_daily_limit from schedule_original_settings s;
revoke execute on function public.enqueue_bookmark_health_daily() from health_schedule_login;
revoke authenticated from health_schedule_login;drop role health_schedule_login;
select * from finish();
\if :schedule_dblink_preexisting
\else
 drop extension dblink;
\endif
