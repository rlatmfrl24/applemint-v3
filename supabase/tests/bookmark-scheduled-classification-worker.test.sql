begin;
select no_plan();
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
update public.bookmark_jobs set state='paused';
update public.bookmarks set state='trash';
insert into public.bookmark_collections(id,name) values
 (md5('worker-original')::uuid,'Original'),(md5('worker-topic')::uuid,'Topic'),(md5('worker-gone')::uuid,'Archived topic');
insert into public.bookmarks(id,url,url_key,collection_id,saved_at,created_at)
select md5('worker-item-'||i)::uuid,'https://worker.example/'||i,'https://worker.example/'||i,md5('worker-original')::uuid,'2000-01-01','2000-01-01'
from generate_series(1,8) i;
select public.bookmark_scheduled_classification_update_settings(true,8);
create temporary table worker_round as select private.enqueue_bookmark_scheduled_classification('2030-01-01 09:00+09') as id;
insert into public.bookmark_jobs(id,kind,available_at) values
 (md5('worker-manual')::uuid,'classify',now()-interval '1 minute'),(md5('worker-recommend')::uuid,'recommend',now());
select is(public.bookmark_worker_claim()->'job'->>'id',md5('worker-recommend')::uuid::text,'save recommendation is claimed first');
select is(public.bookmark_worker_claim()->'job'->>'id',md5('worker-manual')::uuid::text,'manual classification is claimed before a scheduled round');
select ok(public.bookmark_ai_reserve(md5('worker-manual-charge')::uuid,id,lease_token,100,1000,'openrouter','openai/gpt-6-luna'),'manual job uses the regular budget path')
from public.bookmark_jobs where id=md5('worker-manual')::uuid;
select is(public.bookmark_worker_claim()->'job'->>'id',(select id::text from worker_round),'the scheduled round can be claimed');
select ok(not has_function_privilege('authenticated','public.bookmark_scheduled_classification_reserve(uuid,uuid,uuid,int,bigint,text,text)','execute'),'only the worker can reserve');

select public.bookmark_scheduled_classification_update_settings(false,8);
select is(public.bookmark_scheduled_classification_reserve(md5('worker-cost-1')::uuid,j.id,j.lease_token,100,1000,'openrouter','openai/gpt-6-luna'),'disabled','disabling before reservation stops new spending')
from public.bookmark_jobs j join worker_round r on j.id=r.id;
select ok(not public.bookmark_ai_reserve(md5('worker-cost-1')::uuid,j.id,j.lease_token,100,1000,'openrouter','openai/gpt-6-luna'),'the ordinary worker reservation cannot bypass scheduled admission')
from public.bookmark_jobs j join worker_round r on j.id=r.id;
select is((select count(*) from public.bookmark_ai_reservations a join worker_round r on a.job_id=r.id),0::bigint,'there is no receipt for blocked requests');
select ok(public.bookmark_worker_commit(j.id,j.lease_token,'{"state":"retry"}'),'a lease acquired before disable can return pending work')
from public.bookmark_jobs j join worker_round r on j.id=r.id;
select is(public.bookmark_worker_claim(),null::jsonb,'disabled scheduling does not claim queued work');

select public.bookmark_scheduled_classification_update_settings(true,8);
select is(public.bookmark_worker_claim()->'job'->>'id',(select id::text from worker_round),'reenabling continues the same round');
select is(public.bookmark_scheduled_classification_reserve(md5('worker-cost-1')::uuid,j.id,j.lease_token,100,1000000000,'openrouter','openai/gpt-6-luna'),'denied','the existing monthly budget rejects overcommit')
from public.bookmark_jobs j join worker_round r on j.id=r.id;
select is(public.bookmark_scheduled_classification_reserve(md5('worker-cost-1')::uuid,j.id,j.lease_token,100,1000,'openrouter','openai/gpt-6-luna'),'reserved','enabled classification can reserve shared budget')
from public.bookmark_jobs j join worker_round r on j.id=r.id;

select public.bookmark_scheduled_classification_update_settings(false,8);
select is(public.bookmark_scheduled_classification_reserve(md5('worker-cost-2')::uuid,j.id,j.lease_token,100,1000,'openrouter','openai/gpt-6-luna'),'disabled','a later request cannot reserve after disabling')
from public.bookmark_jobs j join worker_round r on j.id=r.id;
update public.bookmarks set version=version+1 where id=md5('worker-item-2')::uuid;
update public.bookmarks set state='trash' where id=md5('worker-item-3')::uuid;
update public.bookmark_collections set archived_at=now() where id=md5('worker-gone')::uuid;
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,target_collection_id,reason)
values (md5('worker-manual')::uuid,md5('worker-item-5')::uuid,1,'classify',md5('worker-topic')::uuid,'manual result');
create temporary table worker_before as
select id,state,version,collection_id from public.bookmarks where url_key like 'https://worker.example/%';
select ok(public.bookmark_worker_commit(j.id,j.lease_token,jsonb_build_object(
 'reservationId',md5('worker-cost-1')::uuid,'reservationState','settled','chargedNano',750,'outputTokens',20,
 'items',(select jsonb_agg(jsonb_build_object('id',md5('worker-item-'||i)::uuid,'version',1,
  'result',jsonb_build_object('reason','topic match'),'proposal',jsonb_build_object('reason','topic match',
   'collectionId',case i when 4 then md5('worker-gone')::uuid when 6 then md5('worker-original')::uuid when 7 then null else md5('worker-topic')::uuid end)))
  from generate_series(1,7) i)
 )),'a budget reservation made before disabling can be settled and publish valid proposals')
from public.bookmark_jobs j join worker_round r on j.id=r.id;
select is((select state from public.bookmark_ai_reservations where id=md5('worker-cost-1')::uuid),'settled','receipt survives validation of all items');
select results_eq(
 $$select bookmark_id,target_collection_id from public.bookmark_proposals where job_id=(select id from worker_round)$$,
 $$select md5('worker-item-1')::uuid,md5('worker-topic')::uuid$$,
 'only a different active destination with a current bookmark and no earlier proposal is published');
select is((select count(*) from public.bookmark_job_items where job_id=(select id from worker_round) and state='failed' and error is not null),3::bigint,'edit, trash and archive have item failures');
select results_eq(
 $$select id,state,version,collection_id from public.bookmarks where url_key like 'https://worker.example/%' order by id$$,
 $$select id,state,version,collection_id from worker_before order by id$$,
 'proposals leave bookmark state and versions alone');
select is((select count(*) from public.bookmark_events where bookmark_id in (select id from worker_before) and kind='move'),0::bigint,'classification creates no move events');

select public.bookmark_scheduled_classification_update_settings(true,8);
select is(public.bookmark_worker_claim()->'job'->>'id',(select id::text from worker_round),'the final pending item can be claimed');
select is(public.bookmark_scheduled_classification_reserve(md5('worker-cost-2')::uuid,j.id,j.lease_token,100,1000,'openrouter','openai/gpt-6-luna'),'reserved','the request that will lose its response reserves normally')
from public.bookmark_jobs j join worker_round r on j.id=r.id;
select public.bookmark_scheduled_classification_update_settings(false,8);
update public.bookmark_jobs set lease_expires_at=now()-interval '1 second' where id=(select id from worker_round);
select is(public.bookmark_worker_claim(),null::jsonb,'expired paid lease recovers without another model claim when disabled');
select is((select state from public.bookmark_ai_reservations where id=md5('worker-cost-2')::uuid),'uncertain','expired paid receipt is retained as uncertain');
select is((select state from public.bookmark_jobs join worker_round using(id)),'paused','lost paid response pauses the round');
select public.bookmark_scheduled_classification_update_settings(true,8);
select is(private.enqueue_bookmark_scheduled_classification('2030-02-01 09:00+09'),null::uuid,'the next month does not bypass an uncertain round');
select is(public.bookmark_worker_claim(),null::jsonb,'a paused round is not automatically replayed');
select * from finish();
rollback;
