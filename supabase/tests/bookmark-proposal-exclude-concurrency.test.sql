select exists(select 1 from pg_extension where extname='dblink') as exclude_dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as exclude_password \gset
create role bookmark_exclude_login login password :'exclude_password';
grant authenticated to bookmark_exclude_login;
grant usage on schema private to bookmark_exclude_login;
create function private.try_bookmark_exclude(p_action text,p_input jsonb) returns jsonb language plpgsql set search_path='' as $$
begin return public.bookmark_command(p_action,p_input); exception when others then return jsonb_build_object('error',sqlstate); end $$;
revoke all on function private.try_bookmark_exclude(text,jsonb) from public;
grant execute on function private.try_bookmark_exclude(text,jsonb) to bookmark_exclude_login;
insert into public.bookmark_jobs(id,kind,state) values ('aaaaaaaa-9600-4000-8000-000000000001','classify','succeeded');
insert into public.bookmarks(id,url,url_key,title) values
 ('bbbbbbbb-9600-4000-8000-000000000001','https://example.com/exclude-concurrent/1','https://example.com/exclude-concurrent/1','Exclude concurrent 1'),
 ('bbbbbbbb-9600-4000-8000-000000000002','https://example.com/exclude-concurrent/2','https://example.com/exclude-concurrent/2','Exclude concurrent 2');
insert into public.bookmark_proposals(id,job_id,bookmark_id,expected_version,kind,reason) values
 ('dddddddd-9600-4000-8000-000000000001','aaaaaaaa-9600-4000-8000-000000000001','bbbbbbbb-9600-4000-8000-000000000001',1,'classify','concurrent exclusion'),
 ('dddddddd-9600-4000-8000-000000000002','aaaaaaaa-9600-4000-8000-000000000001','bbbbbbbb-9600-4000-8000-000000000002',1,'classify','concurrent exclusion');
select plan(4);
select extensions.dblink_connect('exclude_a',format('host=supabase_db_applemint-v3 port=5432 dbname=postgres user=bookmark_exclude_login password=%s',:'exclude_password'));
select extensions.dblink_connect('exclude_b',format('host=supabase_db_applemint-v3 port=5432 dbname=postgres user=bookmark_exclude_login password=%s',:'exclude_password'));
select extensions.dblink_exec('exclude_a',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'; set statement_timeout='5s'$$);
select extensions.dblink_exec('exclude_b',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'; set statement_timeout='5s'$$);
select extensions.dblink_send_query('exclude_a',$$select private.try_bookmark_exclude('proposalExclude','{"items":[{"id":"bbbbbbbb-9600-4000-8000-000000000002","version":1},{"id":"bbbbbbbb-9600-4000-8000-000000000001","version":1}]}')$$);
select extensions.dblink_send_query('exclude_b',$$select private.try_bookmark_exclude('proposalApply','{"items":[{"id":"dddddddd-9600-4000-8000-000000000001"},{"id":"dddddddd-9600-4000-8000-000000000002"}]}')$$);
create temporary table exclude_results(result jsonb);
insert into exclude_results select * from extensions.dblink_get_result('exclude_a') as r(result jsonb);
insert into exclude_results select * from extensions.dblink_get_result('exclude_b') as r(result jsonb);
select is((select count(*) from exclude_results where result ? 'applied'),1::bigint,'only approval or exclusion wins the complete batch');
select is((select count(*) from exclude_results where result->>'error'='PT409'),1::bigint,'the losing batch reports a conflict rather than deadlocking');
select is((select count(distinct state) from public.bookmark_proposals where job_id='aaaaaaaa-9600-4000-8000-000000000001'),1::bigint,'no mix of approved and excluded proposals is committed');
select is((select count(distinct version) from public.bookmarks where id::text like 'bbbbbbbb-9600-%'),1::bigint,'bookmark versions remain atomic across both rows');
select * from extensions.dblink_get_result('exclude_a') as r(result jsonb);
select * from extensions.dblink_get_result('exclude_b') as r(result jsonb);
select extensions.dblink_disconnect('exclude_a');
select extensions.dblink_disconnect('exclude_b');
delete from public.bookmark_proposals where job_id='aaaaaaaa-9600-4000-8000-000000000001';
delete from public.bookmark_jobs where id='aaaaaaaa-9600-4000-8000-000000000001';
delete from public.bookmark_events where bookmark_id::text like 'bbbbbbbb-9600-%';
delete from public.bookmarks where id::text like 'bbbbbbbb-9600-%';
drop function private.try_bookmark_exclude(text,jsonb);
revoke usage on schema private from bookmark_exclude_login;
revoke authenticated from bookmark_exclude_login;
drop role bookmark_exclude_login;
\if :exclude_dblink_preexisting
\else
 drop extension dblink;
\endif
select * from finish();
