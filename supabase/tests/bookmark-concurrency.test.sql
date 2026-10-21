-- Real cross-session RPCs; fixtures never call OpenAI or change the imported library.
select exists(select 1 from pg_extension where extname='dblink') as bookmark_dblink_preexisting \gset
create extension if not exists dblink with schema extensions;
select replace(gen_random_uuid()::text,'-','') as bookmark_test_password \gset
create role bookmark_concurrent_login login password :'bookmark_test_password';
grant authenticated to bookmark_concurrent_login;
grant execute on function public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text),public.bookmark_worker_commit(uuid,uuid,jsonb) to bookmark_concurrent_login;
insert into public.bookmark_jobs(id,kind,state,lease_token,lease_expires_at,total) values
 ('aaaaaaaa-0000-4000-8000-000000000011','classify','processing','cccccccc-0000-4000-8000-000000000011',now()+interval '90 seconds',1),
 ('aaaaaaaa-0000-4000-8000-000000000012','review','processing','cccccccc-0000-4000-8000-000000000012',now()+interval '90 seconds',2);
insert into public.bookmarks(id,url,url_key) values
 ('bbbbbbbb-0000-4000-8000-000000000011','https://example.com/bookmark-concurrent-a','https://example.com/bookmark-concurrent-a'),
 ('bbbbbbbb-0000-4000-8000-000000000012','https://example.com/bookmark-concurrent-b','https://example.com/bookmark-concurrent-b');
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values
 ('aaaaaaaa-0000-4000-8000-000000000012','bbbbbbbb-0000-4000-8000-000000000011',1),
 ('aaaaaaaa-0000-4000-8000-000000000012','bbbbbbbb-0000-4000-8000-000000000012',1);
create function private.delay_bookmark_test_proposal() returns trigger language plpgsql set search_path='' as $$
begin
 if new.job_id='aaaaaaaa-0000-4000-8000-000000000012' then perform pg_sleep(0.75); end if;
 return new;
end $$;
create trigger bookmark_test_proposal_delay before insert on public.bookmark_proposals for each row execute function private.delay_bookmark_test_proposal();
select plan(6);
select extensions.dblink_connect('bookmark_a',format('host=%s port=5432 dbname=postgres user=bookmark_concurrent_login password=%s',host(inet_server_addr()),:'bookmark_test_password'));
select extensions.dblink_connect('bookmark_b',format('host=%s port=5432 dbname=postgres user=bookmark_concurrent_login password=%s',host(inet_server_addr()),:'bookmark_test_password'));
select extensions.dblink_exec('bookmark_b',$$set request.jwt.claim.sub='480f5282-7933-4800-a970-d6bc8f05e8cb'$$);
select greatest(0,1000000000-coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else reserved_nano end),0))::bigint as bookmark_remaining,
 greatest(0,1000000000-coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else reserved_nano end),0))>=2 as bookmark_can_test_budget from public.bookmark_ai_reservations where month=date_trunc('month',now() at time zone 'Asia/Seoul')::date \gset
\if :bookmark_can_test_budget
 select extensions.dblink_send_query('bookmark_a',format($q$with delay as materialized(select pg_sleep(0.2)) select public.bookmark_ai_reserve('eeeeeeee-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000011','cccccccc-0000-4000-8000-000000000011',1,%s,'openrouter','openai/gpt-6-luna') from delay$q$,(:bookmark_remaining::bigint/2)+1));
 select extensions.dblink_send_query('bookmark_b',format($q$with delay as materialized(select pg_sleep(0.2)) select public.bookmark_ai_reserve('eeeeeeee-0000-4000-8000-000000000012','aaaaaaaa-0000-4000-8000-000000000012','cccccccc-0000-4000-8000-000000000012',1,%s,'openrouter','openai/gpt-6-luna') from delay$q$,(:bookmark_remaining::bigint/2)+1));
 create temporary table bookmark_budget_results(result boolean);
 insert into bookmark_budget_results select * from extensions.dblink_get_result('bookmark_a') as r(result boolean);
 insert into bookmark_budget_results select * from extensions.dblink_get_result('bookmark_b') as r(result boolean);
 select is((select count(*) from bookmark_budget_results where result),1::bigint,'simultaneous reservations admit only one request');
 select ok((select coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else reserved_nano end),0)<=1000000000 from public.bookmark_ai_reservations where month=date_trunc('month',now() at time zone 'Asia/Seoul')::date),'authoritative ledger stays within $1');
 select * from extensions.dblink_get_result('bookmark_a') as r(result boolean);
 select * from extensions.dblink_get_result('bookmark_b') as r(result boolean);
\else
 select skip('existing budget has no room for two reservations',2);
\endif
select extensions.dblink_send_query('bookmark_a',format($q$select public.bookmark_worker_commit('aaaaaaaa-0000-4000-8000-000000000012','cccccccc-0000-4000-8000-000000000012',jsonb_build_object('interestVersion',%s,'items','[{"id":"bbbbbbbb-0000-4000-8000-000000000012","version":1,"reviewRevision":0,"proposal":{"reason":"before keep"}},{"id":"bbbbbbbb-0000-4000-8000-000000000011","version":1,"reviewRevision":0,"proposal":{"reason":"before keep"}}]'::jsonb))$q$,(select interest_version from public.bookmark_settings)));
select pg_sleep(0.2);
select extensions.dblink_send_query('bookmark_b',$q$select public.bookmark_command('bulk','{"action":"keep","items":[{"id":"bbbbbbbb-0000-4000-8000-000000000011","version":1},{"id":"bbbbbbbb-0000-4000-8000-000000000012","version":1}]}')$q$);
select ok(result,'reversed model order commits without deadlock') from extensions.dblink_get_result('bookmark_a') as r(result boolean);
select is((result->>'applied')::int,2,'concurrent bulk keep completes') from extensions.dblink_get_result('bookmark_b') as r(result jsonb);
select is((select count(*) from public.bookmark_proposals where job_id='aaaaaaaa-0000-4000-8000-000000000012' and state='pending'),0::bigint,'keep excludes proposals committed concurrently');
select is((select count(*) from public.bookmarks where id in ('bbbbbbbb-0000-4000-8000-000000000011','bbbbbbbb-0000-4000-8000-000000000012') and review_revision=1),2::bigint,'latest review decisions persist for both items');
select extensions.dblink_disconnect('bookmark_a');
select extensions.dblink_disconnect('bookmark_b');
drop trigger bookmark_test_proposal_delay on public.bookmark_proposals;
drop function private.delay_bookmark_test_proposal();
delete from public.bookmark_proposals where job_id='aaaaaaaa-0000-4000-8000-000000000012';
delete from public.bookmark_events where bookmark_id in ('bbbbbbbb-0000-4000-8000-000000000011','bbbbbbbb-0000-4000-8000-000000000012');
delete from public.bookmark_job_items where job_id='aaaaaaaa-0000-4000-8000-000000000012';
delete from public.bookmarks where id in ('bbbbbbbb-0000-4000-8000-000000000011','bbbbbbbb-0000-4000-8000-000000000012');
delete from public.bookmark_ai_reservations where job_id in ('aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000012');
delete from public.bookmark_jobs where id in ('aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000012');
revoke execute on function public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text),public.bookmark_worker_commit(uuid,uuid,jsonb) from bookmark_concurrent_login;
revoke authenticated from bookmark_concurrent_login;
drop role bookmark_concurrent_login;
select * from finish();
\if :bookmark_dblink_preexisting
\else
 drop extension dblink;
\endif
