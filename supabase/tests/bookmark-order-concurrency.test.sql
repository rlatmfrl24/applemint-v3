select exists(select 1 from pg_extension where extname='dblink') as order_dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as order_password \gset
create role bookmark_order_login login password :'order_password';
grant authenticated to bookmark_order_login;
grant usage on schema private to bookmark_order_login;
create function private.try_bookmark_order(p_action text,p_input jsonb) returns jsonb language plpgsql set search_path='' as $$
begin return public.bookmark_command(p_action,p_input); exception when others then return jsonb_build_object('error',sqlstate); end $$;
revoke all on function private.try_bookmark_order(text,jsonb) from public;
grant execute on function private.try_bookmark_order(text,jsonb) to bookmark_order_login;
insert into public.bookmark_collections(id,name,parent_id) values
 ('dddddddd-6000-4000-8000-000000000001','Order concurrent parent',null),
 ('dddddddd-6000-4000-8000-000000000002','A','dddddddd-6000-4000-8000-000000000001'),
 ('dddddddd-6000-4000-8000-000000000003','B','dddddddd-6000-4000-8000-000000000001'),
 ('dddddddd-6000-4000-8000-000000000004','C','dddddddd-6000-4000-8000-000000000001');
create temporary table order_results(result jsonb);
select plan(7);
select extensions.dblink_connect('order_a',format('host=supabase_db_applemint-v3 port=5432 dbname=postgres user=bookmark_order_login password=%s',:'order_password'));
select extensions.dblink_connect('order_b',format('host=supabase_db_applemint-v3 port=5432 dbname=postgres user=bookmark_order_login password=%s',:'order_password'));
select extensions.dblink_exec('order_a',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_exec('order_b',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select extensions.dblink_send_query('order_a',$$select private.try_bookmark_order('collectionReorder','{"id":"dddddddd-6000-4000-8000-000000000004","version":1,"targetId":"dddddddd-6000-4000-8000-000000000002","targetVersion":1,"position":"before"}')$$);
select extensions.dblink_send_query('order_b',$$select private.try_bookmark_order('collectionReorder','{"id":"dddddddd-6000-4000-8000-000000000002","version":1,"targetId":"dddddddd-6000-4000-8000-000000000004","targetVersion":1,"position":"after"}')$$);
insert into order_results select result from extensions.dblink_get_result('order_a') as r(result jsonb);
insert into order_results select result from extensions.dblink_get_result('order_b') as r(result jsonb);
select is((select count(*) from order_results where result ? 'id'),1::bigint,'one concurrent reorder succeeds');
select is((select count(*) from order_results where result->>'error'='PT409'),1::bigint,'other reorder rejects stale sibling versions');
select ok((select string_agg(name,',' order by sort_order,id) from public.bookmark_collections where parent_id='dddddddd-6000-4000-8000-000000000001') in ('C,A,B','B,C,A'),'only one complete order persists');
select is((select count(*) from public.bookmark_collections where parent_id='dddddddd-6000-4000-8000-000000000001' and version=2),3::bigint,'all sibling versions advance once');
select * from extensions.dblink_get_result('order_a') as r(result jsonb);
select * from extensions.dblink_get_result('order_b') as r(result jsonb);
truncate order_results;
select extensions.dblink_send_query('order_a',$$select private.try_bookmark_order('collectionReorder','{"id":"dddddddd-6000-4000-8000-000000000004","version":2,"targetId":"dddddddd-6000-4000-8000-000000000003","targetVersion":2,"position":"before"}')$$);
select extensions.dblink_send_query('order_b',$$select private.try_bookmark_order('collectionRemove','{"id":"dddddddd-6000-4000-8000-000000000003","version":2}')$$);
insert into order_results select result from extensions.dblink_get_result('order_a') as r(result jsonb);
insert into order_results select result from extensions.dblink_get_result('order_b') as r(result jsonb);
select is((select count(*) from order_results where not result ? 'error'),1::bigint,'reorder and anchor deletion serialize');
select is((select count(*) from order_results where result->>'error'='PT409'),1::bigint,'losing mutation reports conflict');
select is((select archived_at is not null from public.bookmark_collections where id='dddddddd-6000-4000-8000-000000000003'),(select exists(select 1 from order_results where result ? 'deletedId')),'persisted state agrees with winning mutation');
select extensions.dblink_disconnect('order_a');
select extensions.dblink_disconnect('order_b');
drop table order_results;
drop function private.try_bookmark_order(text,jsonb);
delete from public.bookmark_collections where parent_id='dddddddd-6000-4000-8000-000000000001';
delete from public.bookmark_collections where id='dddddddd-6000-4000-8000-000000000001';
revoke usage on schema private from bookmark_order_login;
revoke authenticated from bookmark_order_login;
drop role bookmark_order_login;
select * from finish();
\if :order_dblink_preexisting
\else
 drop extension dblink;
\endif
