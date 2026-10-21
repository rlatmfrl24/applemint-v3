select exists(select 1 from pg_extension where extname='dblink') as manager_dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as manager_password \gset
create role bookmark_manager_login login password :'manager_password';
grant authenticated to bookmark_manager_login;
grant usage on schema private to bookmark_manager_login;
insert into public.bookmark_collections(id,name) values
 ('dddddddd-2000-4000-8000-000000000001','Manager concurrent save'),
 ('dddddddd-2000-4000-8000-000000000002','Manager concurrent approve');
insert into public.bookmarks(id,url,url_key,title) values
 ('bbbbbbbb-2000-4000-8000-000000000001','https://example.com/manager-concurrent-proposal','https://example.com/manager-concurrent-proposal','Manager concurrent proposal');
insert into public.bookmark_jobs(id,kind,state) values ('aaaaaaaa-2000-4000-8000-000000000001','classify','succeeded');
insert into public.bookmark_proposals(id,job_id,bookmark_id,expected_version,kind,target_collection_id,reason) values
 ('eeeeeeee-2000-4000-8000-000000000001','aaaaaaaa-2000-4000-8000-000000000001','bbbbbbbb-2000-4000-8000-000000000001',1,'classify','dddddddd-2000-4000-8000-000000000002','concurrent destination');
create function private.delay_manager_archive() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id in ('dddddddd-2000-4000-8000-000000000001','dddddddd-2000-4000-8000-000000000002') then perform pg_sleep(0.6); end if;
 return new;
end $$;
create trigger manager_archive_delay before update of archived_at on public.bookmark_collections for each row execute function private.delay_manager_archive();
create function private.manager_try(p_action text,p_input jsonb) returns jsonb language plpgsql set search_path='' as $$
begin return public.bookmark_command(p_action,p_input); exception when others then return jsonb_build_object('error',sqlstate); end $$;
revoke all on function private.manager_try(text,jsonb) from public;
grant execute on function private.manager_try(text,jsonb) to bookmark_manager_login;
select plan(6);
select extensions.dblink_connect('manager_a',format('host=%s port=5432 dbname=postgres user=bookmark_manager_login password=%s',host(inet_server_addr()),:'manager_password'));
select extensions.dblink_connect('manager_b',format('host=%s port=5432 dbname=postgres user=bookmark_manager_login password=%s',host(inet_server_addr()),:'manager_password'));
select extensions.dblink_exec('manager_a',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_exec('manager_b',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_send_query('manager_a',$$select public.bookmark_command('collectionRemove','{"id":"dddddddd-2000-4000-8000-000000000001","version":1}')$$);
select pg_sleep(0.2);
select extensions.dblink_send_query('manager_b',$$select private.manager_try('save','{"url":"https://example.com/manager-concurrent-save","collectionId":"dddddddd-2000-4000-8000-000000000001"}')$$);
select is(result->>'deletedId','dddddddd-2000-4000-8000-000000000001','delete racing save completes') from extensions.dblink_get_result('manager_a') as r(result jsonb);
select is(result->>'error','PT409','racing save observes deletion instead of archived membership') from extensions.dblink_get_result('manager_b') as r(result jsonb);
select is((select count(*) from public.bookmarks where url='https://example.com/manager-concurrent-save'),0::bigint,'rejected save leaves no record');
select * from extensions.dblink_get_result('manager_a') as r(result jsonb);
select * from extensions.dblink_get_result('manager_b') as r(result jsonb);
select extensions.dblink_send_query('manager_a',$$select public.bookmark_command('collectionRemove','{"id":"dddddddd-2000-4000-8000-000000000002","version":1}')$$);
select pg_sleep(0.2);
select extensions.dblink_send_query('manager_b',$$select private.manager_try('proposalApply','{"items":[{"id":"eeeeeeee-2000-4000-8000-000000000001"}]}')$$);
select is(result->>'deletedId','dddddddd-2000-4000-8000-000000000002','delete racing approval completes') from extensions.dblink_get_result('manager_a') as r(result jsonb);
select is(result->>'error','PT409','racing approval rejects invalidated proposal without deadlock') from extensions.dblink_get_result('manager_b') as r(result jsonb);
select is((select collection_id from public.bookmarks where id='bbbbbbbb-2000-4000-8000-000000000001'),null::uuid,'no move to archived collection');
select extensions.dblink_disconnect('manager_a');
select extensions.dblink_disconnect('manager_b');
drop trigger manager_archive_delay on public.bookmark_collections;
drop function private.delay_manager_archive();
drop function private.manager_try(text,jsonb);
delete from public.bookmark_proposals where id='eeeeeeee-2000-4000-8000-000000000001';
delete from public.bookmarks where id='bbbbbbbb-2000-4000-8000-000000000001';
delete from public.bookmark_jobs where id='aaaaaaaa-2000-4000-8000-000000000001';
delete from public.bookmark_collections where id in ('dddddddd-2000-4000-8000-000000000001','dddddddd-2000-4000-8000-000000000002');
revoke usage on schema private from bookmark_manager_login;
revoke authenticated from bookmark_manager_login;
drop role bookmark_manager_login;
select * from finish();
\if :manager_dblink_preexisting
\else
 drop extension dblink;
\endif
