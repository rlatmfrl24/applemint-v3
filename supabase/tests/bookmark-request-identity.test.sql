begin;
select plan(10);
delete from public.bookmark_ai_reservations;
insert into public.bookmark_jobs(id,kind,state,lease_token,lease_expires_at,progress) values
 ('aaaaaaaa-9500-4000-8000-000000000001','interests','processing','cccccccc-9500-4000-8000-000000000001',now()+interval '90 seconds','{}');
insert into public.bookmark_ai_reservations(id,job_id,month,input_tokens,reserved_nano,charged_nano,state) values
 ('eeeeeeee-9500-4000-8000-000000000001','aaaaaaaa-9500-4000-8000-000000000001',date_trunc('month',now() at time zone 'Asia/Seoul')::date,1,10,1,'settled');
select ok(not has_function_privilege('authenticated','public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text)','execute'),'browser callers cannot write request or budget identities');
select ok(not public.bookmark_ai_reserve(gen_random_uuid(),'aaaaaaaa-9500-4000-8000-000000000001','cccccccc-9500-4000-8000-000000000001',1,10,null,'openai/gpt-6-luna'),'missing provider cannot produce an unlabeled new request');
select ok(public.bookmark_ai_reserve('eeeeeeee-9500-4000-8000-000000000002','aaaaaaaa-9500-4000-8000-000000000001','cccccccc-9500-4000-8000-000000000001',128000,20096000,'openrouter','openai/gpt-6-luna'),'a resumed request records its identity in the budget transaction');
select is((select model from public.bookmark_ai_reservations where id='eeeeeeee-9500-4000-8000-000000000002'),'openai/gpt-6-luna','model exists before any response or settlement');
select is((select provider from public.bookmark_ai_reservations where id='eeeeeeee-9500-4000-8000-000000000002'),'openrouter','provider exists before any response or settlement');
select ok(public.bookmark_worker_commit('aaaaaaaa-9500-4000-8000-000000000001','cccccccc-9500-4000-8000-000000000001','{"reservationId":"eeeeeeee-9500-4000-8000-000000000002","reservationState":"uncertain","state":"paused","error":"lost response"}'),'a lost response preserves the labeled reservation');
update public.bookmark_jobs set progress='{"model":"typesafe/jev-1.13","provider":"different-provider"}' where id='aaaaaaaa-9500-4000-8000-000000000001';
select throws_ok($$update public.bookmark_ai_reservations set model='typesafe/jev-1.13' where id='eeeeeeee-9500-4000-8000-000000000002'$$,'22023','request identity is immutable','settlement cannot rewrite the sent model');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is((select (m->>'requests')::int from jsonb_array_elements(public.bookmark_ai_usage()->'models') m where m->>'model' is null),1,'unknown historical identity remains unknown after resume');
select is((select (m->>'heldNano')::bigint from jsonb_array_elements(public.bookmark_ai_usage()->'models') m where m->>'provider'='openrouter' and m->>'model'='openai/gpt-6-luna'),20096000::bigint,'failed requests remain attributed to their actual requested model');
select is((public.bookmark_ai_usage()->>'usedNano')::bigint,(public.bookmark_snapshot()->'budget'->>'used_nano')::bigint,'model attribution preserves the authoritative monthly gate');
select * from finish();
rollback;
