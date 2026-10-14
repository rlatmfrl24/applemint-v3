begin;
select plan(9);
update public.bookmark_jobs set state='paused';
delete from public.bookmark_ai_reservations;
insert into public.bookmark_jobs(id,kind,state,lease_token,lease_expires_at) values
 ('aaaaaaaa-9100-4000-8000-000000000001','recommend','processing','cccccccc-9100-4000-8000-000000000001',now()+interval '90 seconds'),
 ('aaaaaaaa-9100-4000-8000-000000000002','interests','processing','cccccccc-9100-4000-8000-000000000002',now()+interval '90 seconds');
select ok(public.bookmark_ai_reserve('eeeeeeee-9100-4000-8000-000000000001','aaaaaaaa-9100-4000-8000-000000000001','cccccccc-9100-4000-8000-000000000001',65536,2752512,'openrouter','typesafe/jev-1.13'),'reserve before sending a recommendation');
select lives_ok($$select public.bookmark_worker_commit('aaaaaaaa-9100-4000-8000-000000000001','cccccccc-9100-4000-8000-000000000001','{"state":"paused","reservationId":"eeeeeeee-9100-4000-8000-000000000001","reservationState":"uncertain","chargedNano":250000000}')$$,'retain a known charge above the reservation');
select is((select charged_nano from public.bookmark_ai_reservations where id='eeeeeeee-9100-4000-8000-000000000001'),250000000::bigint,'known overrun is durable');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is((public.bookmark_snapshot()->'budget'->>'used_nano')::bigint,250000000::bigint,'settings count the known cost instead of the smaller reservation');
reset role;
select ok(not public.bookmark_ai_reserve('eeeeeeee-9100-4000-8000-000000000002','aaaaaaaa-9100-4000-8000-000000000002','cccccccc-9100-4000-8000-000000000002',128000,20096000,'openrouter','openai/gpt-6-luna'),'an unreconciled overrun blocks generative calls even below the monthly cap');
select ok(not public.bookmark_ai_reserve('eeeeeeee-9100-4000-8000-000000000003','aaaaaaaa-9100-4000-8000-000000000002','cccccccc-9100-4000-8000-000000000002',65536,2752512,'openrouter','openai/gpt-6-luna'),'the same guard blocks recommendation calls');
select throws_ok($$update public.bookmark_ai_reservations set state='settled' where id='eeeeeeee-9100-4000-8000-000000000001'$$,'23514',null,'an overrun cannot silently settle below its charge');
update public.bookmark_ai_reservations set charged_nano=1200000000 where id='eeeeeeee-9100-4000-8000-000000000001';
set local role authenticated;
select is((public.bookmark_snapshot()->'budget'->>'used_nano')::bigint,1200000000::bigint,'a charge above one dollar is never hidden');
reset role;
update public.bookmark_ai_reservations set reserved_nano=1200000000,state='settled' where id='eeeeeeee-9100-4000-8000-000000000001';
select ok(not public.bookmark_ai_reserve('eeeeeeee-9100-4000-8000-000000000004','aaaaaaaa-9100-4000-8000-000000000002','cccccccc-9100-4000-8000-000000000002',128000,20096000,'openrouter','openai/gpt-6-luna'),'reconciliation cannot reopen a monthly cap already exceeded');
select * from finish();
rollback;
