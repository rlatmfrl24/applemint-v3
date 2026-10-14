begin;
select plan(15);
delete from public.bookmark_ai_reservations;
select ok(not has_function_privilege('anon','public.bookmark_ai_usage()','execute'),'usage is not public');
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
select throws_ok($$select public.bookmark_ai_usage()$$,'42501','owner required','another user cannot read AI spending');
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is(public.bookmark_ai_usage()->>'month',date_trunc('month',now() at time zone 'Asia/Seoul')::date::text,'calendar month follows KST');
select is(public.bookmark_ai_usage()->'models','[]'::jsonb,'empty usage does not invent model ratios');
reset role;
insert into public.bookmark_jobs(id,kind,state,progress) values
 ('aaaaaaaa-9300-4000-8000-000000000001','classify','succeeded','{"model":"openai/gpt-6-luna"}'),
 ('aaaaaaaa-9300-4000-8000-000000000002','recommend','succeeded','{"model":"typesafe/jev-1.13"}'),
 ('aaaaaaaa-9300-4000-8000-000000000003','review','succeeded','{}');
insert into public.bookmark_ai_reservations(id,job_id,month,input_tokens,reserved_nano,charged_nano,state,provider,model)
 select gen_random_uuid(),'aaaaaaaa-9300-4000-8000-000000000001',date_trunc('month',now() at time zone 'Asia/Seoul')::date,128000,20,10,'settled','openrouter','openai/gpt-6-luna' from generate_series(1,35);
insert into public.bookmark_ai_reservations(id,job_id,month,input_tokens,reserved_nano,charged_nano,state,provider,model) values
 (gen_random_uuid(),'aaaaaaaa-9300-4000-8000-000000000002',date_trunc('month',now() at time zone 'Asia/Seoul')::date,65536,100,70,'settled','openrouter','typesafe/jev-1.13'),
 (gen_random_uuid(),'aaaaaaaa-9300-4000-8000-000000000003',date_trunc('month',now() at time zone 'Asia/Seoul')::date,100,100,25,'settled',null,null),
 (gen_random_uuid(),'aaaaaaaa-9300-4000-8000-000000000001',date_trunc('month',now() at time zone 'Asia/Seoul')::date,128000,1000,1200,'uncertain','openrouter','openai/gpt-6-luna'),
 (gen_random_uuid(),'aaaaaaaa-9300-4000-8000-000000000001',(date_trunc('month',now() at time zone 'Asia/Seoul')-interval '1 month')::date,128000,100,99,'settled','openrouter','openai/gpt-6-luna'),
 (gen_random_uuid(),'aaaaaaaa-9300-4000-8000-000000000002',date_trunc('month',now() at time zone 'Asia/Seoul')::date,65536,100,null,'released','openrouter','typesafe/jev-1.13');
set local role authenticated;
select is((public.bookmark_ai_usage()->>'requestCount')::int,38,'all current-month reservations count beyond the recent jobs window');
select is(jsonb_array_length(public.bookmark_ai_usage()->'models'),3,'both models and unknown history remain distinct');
select is((public.bookmark_ai_usage()->>'chargedNano')::bigint,445::bigint,'actual settled costs are not reserved token ceilings');
select is((public.bookmark_ai_usage()->>'heldNano')::bigint,1200::bigint,'uncertain known overruns use the larger amount');
select is((select (m->>'requests')::int from jsonb_array_elements(public.bookmark_ai_usage()->'models') m where m->>'model' is null),1,'historical missing model metadata is not guessed');
select is((public.bookmark_ai_usage()->>'usedNano')::bigint,(public.bookmark_snapshot()->'budget'->>'used_nano')::bigint,'usage matches the authoritative monthly budget gate');
select is((select (m->>'requests')::int from jsonb_array_elements(public.bookmark_ai_usage()->'models') m where m->>'model'='openai/gpt-6-luna'),36,'multiple calls within one job remain separate requests');
reset role;
update public.bookmark_jobs set progress='{"model":"typesafe/jev-1.13","provider":"changed-job-metadata"}' where id='aaaaaaaa-9300-4000-8000-000000000001';
set local role authenticated;
select is((select (m->>'requests')::int from jsonb_array_elements(public.bookmark_ai_usage()->'models') m where m->>'model'='openai/gpt-6-luna'),36,'later job metadata cannot relabel earlier requests');
select is((public.bookmark_ai_usage()->>'usedNano')::bigint,1645::bigint,'model metadata changes never alter the monthly budget');
select lives_ok($$select public.bookmark_command('interests',jsonb_build_object('interests',jsonb_build_array('Chip topic'),'version',(select interest_version from public.bookmark_settings)))$$,'current topic chips save atomically');
select throws_ok($$select public.bookmark_command('interests',jsonb_build_object('interests',jsonb_build_array('Stale topic'),'version',(select interest_version-1 from public.bookmark_settings)))$$,'PT409','interests changed','a stale editor cannot overwrite newly saved topics');
select * from finish();
rollback;
