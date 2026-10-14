select exists(select 1 from pg_extension where extname='dblink') as move_dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as move_password \gset
create role bookmark_move_login login password :'move_password';
grant authenticated to bookmark_move_login;
grant usage on schema private to bookmark_move_login;
create function private.try_bookmark_move(p_action text,p_input jsonb) returns jsonb language plpgsql set search_path='' as $$
begin return public.bookmark_command(p_action,p_input); exception when others then return jsonb_build_object('error',sqlstate); end $$;
revoke all on function private.try_bookmark_move(text,jsonb) from public;
grant execute on function private.try_bookmark_move(text,jsonb) to bookmark_move_login;
insert into public.bookmark_collections(id,name) values
 ('dddddddd-4000-4000-8000-000000000001','Move concurrent A'),
 ('dddddddd-4000-4000-8000-000000000002','Move concurrent B');
insert into public.bookmarks(id,url,url_key) values
 ('bbbbbbbb-4000-4000-8000-000000000001','https://example.com/move-concurrent-a','https://example.com/move-concurrent-a'),
 ('bbbbbbbb-4000-4000-8000-000000000002','https://example.com/move-concurrent-b','https://example.com/move-concurrent-b');
create temporary table move_results(result jsonb);
select plan(7);
select extensions.dblink_connect('move_a',format('host=supabase_db_applemint-v3 port=5432 dbname=postgres user=bookmark_move_login password=%s',:'move_password'));
select extensions.dblink_connect('move_b',format('host=supabase_db_applemint-v3 port=5432 dbname=postgres user=bookmark_move_login password=%s',:'move_password'));
select extensions.dblink_exec('move_a',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_exec('move_b',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_send_query('move_a',$$select private.try_bookmark_move('collectionMove','{"id":"dddddddd-4000-4000-8000-000000000001","version":1,"parentId":"dddddddd-4000-4000-8000-000000000002"}')$$);
select extensions.dblink_send_query('move_b',$$select private.try_bookmark_move('collectionMove','{"id":"dddddddd-4000-4000-8000-000000000002","version":1,"parentId":"dddddddd-4000-4000-8000-000000000001"}')$$);
insert into move_results select result from extensions.dblink_get_result('move_a') as r(result jsonb);
insert into move_results select result from extensions.dblink_get_result('move_b') as r(result jsonb);
select is((select count(*) from move_results where result ? 'id'),1::bigint,'one concurrent reparent succeeds');
select is((select count(*) from move_results where result->>'error'='22023'),1::bigint,'other reparent rejects resulting cycle');
select is((select count(*) from public.bookmark_collections a join public.bookmark_collections b on a.parent_id=b.id and b.parent_id=a.id where a.id in ('dddddddd-4000-4000-8000-000000000001','dddddddd-4000-4000-8000-000000000002')),0::bigint,'mutual cycle never persists');
select * from extensions.dblink_get_result('move_a') as r(result jsonb);
select * from extensions.dblink_get_result('move_b') as r(result jsonb);
truncate move_results;
select extensions.dblink_send_query('move_a',$$select private.try_bookmark_move('bulkMove','{"items":[{"id":"bbbbbbbb-4000-4000-8000-000000000001","version":1},{"id":"bbbbbbbb-4000-4000-8000-000000000002","version":1}],"collectionId":"dddddddd-4000-4000-8000-000000000001"}')$$);
select extensions.dblink_send_query('move_b',$$select private.try_bookmark_move('bulkMove','{"items":[{"id":"bbbbbbbb-4000-4000-8000-000000000002","version":1},{"id":"bbbbbbbb-4000-4000-8000-000000000001","version":1}],"collectionId":"dddddddd-4000-4000-8000-000000000002"}')$$);
insert into move_results select result from extensions.dblink_get_result('move_a') as r(result jsonb);
insert into move_results select result from extensions.dblink_get_result('move_b') as r(result jsonb);
select is((select count(*) from move_results where (result->>'applied')::int=2),1::bigint,'one full batch succeeds without deadlock');
select is((select count(*) from move_results where result->>'error'='PT409'),1::bigint,'other full batch reports version conflict');
select is((select count(distinct collection_id) from public.bookmarks where id in ('bbbbbbbb-4000-4000-8000-000000000001','bbbbbbbb-4000-4000-8000-000000000002')),1::bigint,'both bookmarks keep the same winning destination');
select is((select count(*) from public.bookmarks where id in ('bbbbbbbb-4000-4000-8000-000000000001','bbbbbbbb-4000-4000-8000-000000000002') and version=2),2::bigint,'no extra or partial mutations');
select extensions.dblink_disconnect('move_a');
select extensions.dblink_disconnect('move_b');
drop table move_results;
drop function private.try_bookmark_move(text,jsonb);
delete from public.bookmark_events where bookmark_id in ('bbbbbbbb-4000-4000-8000-000000000001','bbbbbbbb-4000-4000-8000-000000000002');
delete from public.bookmarks where id in ('bbbbbbbb-4000-4000-8000-000000000001','bbbbbbbb-4000-4000-8000-000000000002');
delete from public.bookmark_collections where id in ('dddddddd-4000-4000-8000-000000000001','dddddddd-4000-4000-8000-000000000002');
revoke usage on schema private from bookmark_move_login;
revoke authenticated from bookmark_move_login;
drop role bookmark_move_login;
select * from finish();
\if :move_dblink_preexisting
\else
 drop extension dblink;
\endif
