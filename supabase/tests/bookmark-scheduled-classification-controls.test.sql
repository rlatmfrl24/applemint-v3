begin;
select no_plan();
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
update public.bookmarks set state='trash';
insert into public.bookmark_collections(id,name) values(md5('close-target')::uuid,'Target');
insert into public.bookmarks(id,url,url_key,saved_at,created_at)
select md5('close-item-'||i)::uuid,'https://close.example/'||i,'https://close.example/'||i,
 '2000-01-01'::timestamptz+i*interval '1 minute','2000-01-01' from generate_series(1,3) i;
select public.bookmark_scheduled_classification_update_settings(true,2);
create temporary table closed_round as select private.enqueue_bookmark_scheduled_classification(
 (((now() at time zone 'Asia/Seoul')::date-1)+time '09:00') at time zone 'Asia/Seoul'
) as id;
insert into public.bookmark_jobs(id,kind,state) values(md5('close-manual-job')::uuid,'classify','paused');
select throws_ok(
 $$select public.bookmark_scheduled_classification_close(id,false) from closed_round$$,
 '22023','round closure requires confirmation','confirmation is mandatory');
select throws_ok(
 $$select public.bookmark_scheduled_classification_close(id,true) from closed_round$$,
 'PT409','scheduled round cannot close','queued rounds cannot close');
select throws_ok(
 $$select public.bookmark_scheduled_classification_close(md5('close-manual-job')::uuid,true)$$,
 'PT409','scheduled round cannot close','manual rounds cannot close through this control');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
select throws_ok(
 $$select public.bookmark_scheduled_classification_close(id,true) from closed_round$$,
 '42501','owner required','only owners can close scheduled rounds');
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select ok(not has_function_privilege('anon','public.bookmark_scheduled_classification_close(uuid,boolean)','execute'),'anonymous closure is denied');

update public.bookmark_jobs set state='paused',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '1 minute'
where id=(select id from closed_round);
select throws_ok(
 $$select public.bookmark_scheduled_classification_close(id,true) from closed_round$$,
 'PT409','scheduled round cannot close','a live lease blocks closure even for a paused round');
update public.bookmark_jobs set lease_expires_at=now()-interval '1 second',completed=1,error='기존 오류'
where id=(select id from closed_round);
update public.bookmark_job_items set state='done',result='{"reason":"preserved result"}'
where job_id=(select id from closed_round) and bookmark_id=md5('close-item-1')::uuid;
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,target_collection_id,reason)
select id,md5('close-item-1')::uuid,1,'classify',md5('close-target')::uuid,'preserved proposal' from closed_round;
insert into public.bookmark_ai_reservations(id,job_id,month,reserved_nano,input_tokens,state)
select md5('close-reservation')::uuid,id,'2026-11-01',1000,100,'uncertain' from closed_round;

create temporary table closure as select public.bookmark_scheduled_classification_close(id,true) result from closed_round;
select is((select result->>'state' from closure),'partial','a round with completed items closes as partial');
select is((select (result->>'completed')::int from closure),1,'completed count is retained');
select is((select (result->>'failed')::int from closure),1,'remaining work is marked failed');
select is((select result->>'error' from closure),'기존 오류','underlying failure remains visible');
select is((select result->'progress'->>'closedAt' is not null from closure),true,'closure time is persisted');
select is((select result->>'reason' from public.bookmark_job_items where job_id=(select id from closed_round) and state='done'),'preserved result','completed results are retained');
select is((select state from public.bookmark_proposals where job_id=(select id from closed_round)),'pending','proposal remains ready for owner review');
select is((select state from public.bookmark_ai_reservations where id=md5('close-reservation')::uuid),'uncertain','uncertain charge is not released');
select ok((select error is not null from public.bookmark_job_items where job_id=(select id from closed_round) and state='failed'),'unfinished item records a closure reason');
select throws_ok(
 $$select public.bookmark_command('resume',jsonb_build_object('id',id)) from closed_round$$,
 'PT409','scheduled round cannot resume','closed job cannot resume');
select throws_ok(
 $$select public.bookmark_scheduled_classification_close(id,true) from closed_round$$,
 'PT409','scheduled round cannot close','closing again cannot change the closure time');
select is(private.enqueue_bookmark_scheduled_classification(
 (((now() at time zone 'Asia/Seoul')::date)+time '23:59') at time zone 'Asia/Seoul'
),null::uuid,'closing blocks the rest of this KST date');
select is((public.bookmark_scheduled_classification_settings()->>'nextEligibleAt')::timestamptz,
 (((now() at time zone 'Asia/Seoul')::date+1)+time '09:00') at time zone 'Asia/Seoul','settings show tomorrow at 09:00 KST');
select is((public.bookmark_command('proposalApply',jsonb_build_object('items',jsonb_build_array(jsonb_build_object(
 'id',(select id from public.bookmark_proposals where job_id=(select id from closed_round)),
 'exclude',true
 ))))->>'applied')::int,1,'owner can exclude a preserved proposal');
create temporary table after_close as select private.enqueue_bookmark_scheduled_classification(
 (((now() at time zone 'Asia/Seoul')::date+1)+time '09:00') at time zone 'Asia/Seoul'
) as id;
select results_eq(
 $$select bookmark_id from public.bookmark_job_items where job_id=(select id from after_close)$$,
 $$select md5('close-item-3')::uuid$$,'the next KST date only admits different candidates');

update public.bookmark_jobs set state='failed' where id=(select id from after_close);
select is(public.bookmark_scheduled_classification_close((select id from after_close),true)->>'state','failed','closing with no completed items leaves a failed round');
select * from finish();
rollback;
