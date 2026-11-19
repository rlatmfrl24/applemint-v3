select exists(select 1 from pg_extension where extname='dblink') as dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as test_password \gset
create role classification_controls_login login password :'test_password';
grant authenticated to classification_controls_login;
insert into public.bookmark_jobs(id,kind,state,scope)
values ('aaaaaaaa-9810-4000-8000-000000000001','classify','paused','{"origin":"scheduled-classify","scheduledDate":"2099-01-01"}');

select plan(3);
select extensions.dblink_connect('close_first',format('host=%s port=5432 dbname=postgres user=classification_controls_login password=%s',host(inet_server_addr()),:'test_password'));
select extensions.dblink_connect('resume_second',format('host=%s port=5432 dbname=postgres user=classification_controls_login password=%s',host(inet_server_addr()),:'test_password'));
select extensions.dblink_exec('close_first',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_exec('resume_second',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_exec('close_first','begin');
select is((select result->>'state' from extensions.dblink('close_first',$$select public.bookmark_scheduled_classification_close('aaaaaaaa-9810-4000-8000-000000000001',true)$$) as r(result jsonb)),
 'failed','first connection closes the round');
select extensions.dblink_send_query('resume_second',$$select public.bookmark_command('resume','{"id":"aaaaaaaa-9810-4000-8000-000000000001"}')$$);
select extensions.dblink_exec('close_first','commit');
select is((select result from extensions.dblink_get_result('resume_second',false) as r(result jsonb)),null::jsonb,'the waiting resume cannot reopen the round');
select ok((select state='failed' and progress ? 'closedAt' from public.bookmark_jobs where id='aaaaaaaa-9810-4000-8000-000000000001'),'the winning transaction remains authoritative');

select extensions.dblink_disconnect('close_first');
select extensions.dblink_disconnect('resume_second');
delete from public.bookmark_jobs where id='aaaaaaaa-9810-4000-8000-000000000001';
revoke authenticated from classification_controls_login;
drop role classification_controls_login;
select * from finish();
\if :dblink_preexisting
\else
 drop extension dblink;
\endif
