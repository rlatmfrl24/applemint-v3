begin;
select no_plan();
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);

select is(public.bookmark_scheduled_classification_settings()->>'status','disabled','scheduling starts disabled');
select is((public.bookmark_scheduled_classification_settings()->>'dailyLimit')::int,100,'default is 100');
select is(private.enqueue_bookmark_scheduled_classification('2030-01-01 09:00+09'),null::uuid,'disabled scheduler creates no work');
select throws_ok($$select public.bookmark_scheduled_classification_update_settings(true,0)$$,'22023','invalid daily limit','zero is rejected');
select throws_ok($$select public.bookmark_scheduled_classification_update_settings(true,501)$$,'22023','invalid daily limit','above 500 is rejected');
select ok(not has_function_privilege('authenticated','private.enqueue_bookmark_scheduled_classification(timestamptz)','execute'),'client cannot pick a scheduler date');
select ok(not has_function_privilege('service_role','private.enqueue_bookmark_scheduled_classification(timestamptz)','execute'),'scheduler stays internal');
select ok(not has_function_privilege('anon','public.bookmark_scheduled_classification_settings()','execute'),'anonymous settings are denied');
select throws_ok($$select public.bookmark_command('start','{"kind":"classify","origin":"scheduled-classify"}')$$,'22023','reserved job origin','manual start cannot impersonate the scheduler');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
select throws_ok($$select public.bookmark_scheduled_classification_update_settings(true,2)$$,'42501','owner required','non-owner cannot enable scheduling');
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);

insert into public.bookmark_collections(id,name) values(md5('schedule-target')::uuid,'Schedule fixture');
insert into public.bookmarks(id,url,url_key,saved_at,created_at,state,version)
select md5('schedule-'||i)::uuid,'https://schedule.example/'||i,'https://schedule.example/'||i,
 '2000-01-01'::timestamptz+i*interval '1 hour','2001-01-01',case when i=1 then 'trash' else 'library' end,i
from generate_series(1,5) i;
create temporary table schedule_initial as select public.bookmark_scheduled_classification_update_settings(true,2) as value;
select is((select value->>'status' from schedule_initial),'waiting','enabling waits for a scheduler run');
insert into public.bookmarks(id,url,url_key,saved_at,created_at)
values(md5('schedule-new')::uuid,'https://schedule.example/new','https://schedule.example/new','1999-01-01',clock_timestamp()+interval '1 day');
update public.bookmarks set state='trash' where url_key not like 'https://schedule.example/%';

insert into public.bookmark_jobs(id,kind,state,scope) values
 (md5('schedule-previous-all')::uuid,'classify','paused','{"scope":"all"}'),
 (md5('schedule-manual')::uuid,'classify','queued','{"scope":"selected"}'),
 (md5('schedule-proposal')::uuid,'classify','succeeded','{"scope":"selected"}');
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values
 (md5('schedule-previous-all')::uuid,md5('schedule-4')::uuid,4),
 (md5('schedule-manual')::uuid,md5('schedule-3')::uuid,3);
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,target_collection_id,reason)
values (md5('schedule-proposal')::uuid,md5('schedule-2')::uuid,2,'classify',md5('schedule-target')::uuid,'manual proposal');

select is(private.enqueue_bookmark_scheduled_classification('2030-01-01 08:59+09'),null::uuid,'08:59 is outside the window');
create temporary table scheduled_first as select private.enqueue_bookmark_scheduled_classification('2030-01-01 09:00+09') as id;
select is((select scope from public.bookmark_jobs where id=(select id from scheduled_first)),
 '{"origin":"scheduled-classify","scope":"selected","scheduledDate":"2030-01-01"}'::jsonb,'jobs have a dedicated origin and KST date');
select is((select total from public.bookmark_jobs where id=(select id from scheduled_first)),2,'first round respects the limit');
select results_eq(
 $$select bookmark_id,expected_version from public.bookmark_job_items where job_id=(select id from scheduled_first) order by expected_version$$,
 $$values (md5('schedule-4')::uuid,4),(md5('schedule-5')::uuid,5)$$,
 'only eligible items enter the queue with their current versions, despite an old paused all-library job');
select is(private.enqueue_bookmark_scheduled_classification('2030-01-02 09:00+09'),null::uuid,'an open round blocks a later date');
update public.bookmark_job_items set state=case expected_version when 4 then 'done' else 'failed' end where job_id=(select id from scheduled_first);
update public.bookmark_jobs set state='partial' where id=(select id from scheduled_first);
select is(private.enqueue_bookmark_scheduled_classification('2030-01-02 09:00+09'),null::uuid,'partial work with failures blocks the next round');
select is(public.bookmark_scheduled_classification_settings()->>'status','blocked','settings surface a recoverable round');
update public.bookmark_jobs set progress=progress||jsonb_build_object('closedAt','2030-01-02T00:30:00Z') where id=(select id from scheduled_first);
select is(private.enqueue_bookmark_scheduled_classification('2030-01-02 10:00+09'),null::uuid,'closing today cannot create another round today');
select is(private.enqueue_bookmark_scheduled_classification('2030-01-03 09:00+09'),null::uuid,'temporary blockers cannot produce empty jobs');
select is((select classify_last_scan_outcome from public.bookmark_settings where id),'deferred','blocked candidates are outstanding');
update public.bookmark_proposals set state='excluded' where job_id=md5('schedule-proposal')::uuid;
update public.bookmark_jobs set state='succeeded' where id=md5('schedule-manual')::uuid;
select is(private.enqueue_bookmark_scheduled_classification('2030-01-03 23:59+09'),null::uuid,'no second scan after an empty day');
create temporary table scheduled_second as select private.enqueue_bookmark_scheduled_classification('2030-01-04 09:00+09') as id;
select results_eq(
 $$select bookmark_id from public.bookmark_job_items where job_id=(select id from scheduled_second) order by expected_version$$,
 $$values (md5('schedule-2')::uuid),(md5('schedule-3')::uuid)$$,
 'expired blockers become eligible; prior completed and failed members do not');
update public.bookmark_jobs set state='succeeded' where id=(select id from scheduled_second);
select is(private.enqueue_bookmark_scheduled_classification('2030-01-05 09:00+09'),null::uuid,'exhaustion also creates no job');
select is(public.bookmark_scheduled_classification_settings()->>'status','complete','only true exhaustion is complete');
select public.bookmark_scheduled_classification_update_settings(false,9);
select is(public.bookmark_scheduled_classification_update_settings(true,9)->>'startedAt',(select value->>'startedAt' from schedule_initial),'toggle preserves the first cutoff');
select is((select count(*) from public.bookmark_jobs where scope->>'origin'='scheduled-classify'),2::bigint,'only nonempty rounds were created');
select * from finish();
rollback;
