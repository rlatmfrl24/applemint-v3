select exists(select 1 from pg_extension where extname='dblink') as dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as test_password \gset
create role classification_schedule_login login password :'test_password';
grant usage on schema private to classification_schedule_login;
grant execute on function private.enqueue_bookmark_scheduled_classification(timestamptz) to classification_schedule_login;
create temporary table classification_original_settings as select * from public.bookmark_settings;
update public.bookmark_settings set classify_auto_enabled=true,classify_daily_limit=2,classify_started_at='2000-01-01' where id;
insert into public.bookmarks(id,url,url_key,saved_at,created_at)
select md5('schedule-race-'||i)::uuid,'https://schedule-race.example/'||i,'https://schedule-race.example/'||i,'1900-01-01','1999-01-01'
from generate_series(1,3) i;

select plan(3);
select extensions.dblink_connect('classification_a',format('host=%s port=5432 dbname=postgres user=classification_schedule_login password=%s',host(inet_server_addr()),:'test_password'));
select extensions.dblink_connect('classification_b',format('host=%s port=5432 dbname=postgres user=classification_schedule_login password=%s',host(inet_server_addr()),:'test_password'));
select extensions.dblink_exec('classification_a','begin');
select id from extensions.dblink('classification_a',$$select private.enqueue_bookmark_scheduled_classification('2035-01-01 09:01+09')$$) as r(id uuid);
select extensions.dblink_send_query('classification_b',$$select private.enqueue_bookmark_scheduled_classification('2035-01-01 09:01+09')$$);
select extensions.dblink_exec('classification_a','commit');
select is((select id from extensions.dblink_get_result('classification_b') as r(id uuid)),null::uuid,'the second session observes the first committed scan');
select is((select count(*) from public.bookmark_jobs where scope->>'origin'='scheduled-classify' and scope->>'scheduledDate'='2035-01-01'),1::bigint,'same-day sessions create just one round');
select is((select count(*) from public.bookmark_job_items i join public.bookmark_jobs j on j.id=i.job_id where j.scope->>'origin'='scheduled-classify' and j.scope->>'scheduledDate'='2035-01-01'),2::bigint,'the limit applies across sessions');
select extensions.dblink_disconnect('classification_a');
select extensions.dblink_disconnect('classification_b');
delete from public.bookmark_job_items where job_id in (select id from public.bookmark_jobs where scope->>'origin'='scheduled-classify' and scope->>'scheduledDate'='2035-01-01');
delete from public.bookmark_jobs where scope->>'origin'='scheduled-classify' and scope->>'scheduledDate'='2035-01-01';
delete from public.bookmarks where url_key like 'https://schedule-race.example/%';
update public.bookmark_settings s set
 classify_auto_enabled=o.classify_auto_enabled,classify_daily_limit=o.classify_daily_limit,classify_started_at=o.classify_started_at,
 classify_last_scan_date=o.classify_last_scan_date,classify_last_scan_outcome=o.classify_last_scan_outcome
from classification_original_settings o where s.id=o.id;
revoke execute on function private.enqueue_bookmark_scheduled_classification(timestamptz) from classification_schedule_login;
revoke usage on schema private from classification_schedule_login;
drop role classification_schedule_login;
select * from finish();
\if :dblink_preexisting
\else
 drop extension dblink;
\endif
