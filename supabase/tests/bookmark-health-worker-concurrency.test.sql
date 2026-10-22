select exists(select 1 from pg_extension where extname='dblink') as health_dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as health_test_password \gset
create role health_concurrent_login login password :'health_test_password';
grant execute on function public.bookmark_health_host_claim(text),public.bookmark_health_host_release(text,uuid,timestamptz) to health_concurrent_login;
select plan(4);
select extensions.dblink_connect('health_a',format('host=%s port=5432 dbname=postgres user=health_concurrent_login password=%s',host(inet_server_addr()),:'health_test_password'));
select extensions.dblink_connect('health_b',format('host=%s port=5432 dbname=postgres user=health_concurrent_login password=%s',host(inet_server_addr()),:'health_test_password'));
select extensions.dblink_send_query('health_a',$q$with delay as materialized(select pg_sleep(0.2)) select public.bookmark_health_host_claim('health-concurrency.example') from delay$q$);
select extensions.dblink_send_query('health_b',$q$with delay as materialized(select pg_sleep(0.2)) select public.bookmark_health_host_claim('health-concurrency.example') from delay$q$);
create temporary table health_permits(result jsonb);
insert into health_permits select * from extensions.dblink_get_result('health_a') as r(result jsonb);
insert into health_permits select * from extensions.dblink_get_result('health_b') as r(result jsonb);
select is((select count(*) from health_permits where result->>'token' is not null),1::bigint,'simultaneous host requests grant exactly one permit');
select is(public.bookmark_health_host_release('health-concurrency.example',gen_random_uuid(),null),false,'unmatched token cannot release a live permit');
update private.bookmark_health_hosts set lease_expires_at=now()-interval '1 second' where host='health-concurrency.example';
select ok(public.bookmark_health_host_claim('health-concurrency.example')->>'token' is not null,'crashed permit recovers after its 15 second lease');
select ok(public.bookmark_health_host_release('health-concurrency.example',(select lease_token from private.bookmark_health_hosts where host='health-concurrency.example'),now()+interval '15 minutes'),'matching permit records a bounded backoff');
select extensions.dblink_disconnect('health_a');
select extensions.dblink_disconnect('health_b');
delete from private.bookmark_health_hosts where host='health-concurrency.example';
revoke execute on function public.bookmark_health_host_claim(text),public.bookmark_health_host_release(text,uuid,timestamptz) from health_concurrent_login;
drop role health_concurrent_login;
select * from finish();
\if :health_dblink_preexisting
\else
 drop extension dblink;
\endif
