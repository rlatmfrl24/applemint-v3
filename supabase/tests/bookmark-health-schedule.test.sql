begin;
select plan(43);
update public.bookmarks set state='trash';update public.bookmark_jobs set state='paused';
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is(public.bookmark_health_settings()->>'enabled','false','automatic checking starts disabled');
select is((public.bookmark_health_settings()->>'dailyLimit')::int,500,'daily default is 500');
select ok(not (public.bookmark_health_settings() ? 'secret'),'settings do not expose tokens');
select throws_ok($$select public.bookmark_health_update_settings(true,0)$$,'22023','invalid daily limit','zero daily limit rejected');
select throws_ok($$select public.bookmark_health_update_settings(true,1001)$$,'22023','invalid daily limit','above maximum daily limit rejected');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
select throws_ok($$select public.bookmark_health_settings()$$,'42501','owner required','non-owner settings rejected');
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
insert into public.bookmark_jobs(id,kind,state) values('aaaaaaaa-9900-4000-8000-000000000001','check','succeeded');
insert into public.bookmarks(id,url,url_key,title,saved_at)
select md5('health-schedule-'||n)::uuid,'https://site'||(n%10)||'.example/'||n,'https://site'||(n%10)||'.example/'||n,'Health schedule '||n,'2020-01-01'::timestamptz+n*interval '1 second' from generate_series(1,1500) n;
insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,reason,checked_url,evidence,checked_at)
select b.id,'aaaaaaaa-9900-4000-8000-000000000001',1,'healthy','schedule',b.url,jsonb_build_object('schemaVersion',1,'coverage','complete','content',jsonb_build_object('status',case when right(b.title,4)::text is null then 'unknown' else 'present' end),'media',jsonb_build_object('status','none_detected'),'ai',jsonb_build_object('state','not_needed')),now()-interval '10 days'
from public.bookmarks b where b.title like 'Health schedule %' and split_part(b.title,' ',3)::int<=200;
insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,reason,checked_url,evidence,checked_at)
select b.id,'aaaaaaaa-9900-4000-8000-000000000001',1,'healthy','schedule',b.url,'{"coverage":"complete","content":{"status":"deleted_suspected"},"media":{"status":"none_detected"},"ai":{"state":"not_needed"}}',now()-interval '31 days'
from public.bookmarks b where b.title like 'Health schedule %' and split_part(b.title,' ',3)::int between 201 and 400;
select is((select count(*) from private.bookmark_health_due((date_trunc('day',now() at time zone 'Asia/Seoul')+interval '8 hours 59 minutes') at time zone 'Asia/Seoul',500)),0::bigint,'08:59 KST is before the daily window');
select is((select count(*) from private.bookmark_health_due((date_trunc('day',now() at time zone 'Asia/Seoul')+interval '9 hours') at time zone 'Asia/Seoul',500)),500::bigint,'09:00 KST respects cap');
select is((select count(*) from private.bookmark_health_due(now(),500) d join public.bookmarks b on b.id=d.bookmark_id where split_part(b.title,' ',3)::int<=200),50::bigint,'normal sample quota is 50');
select is((select count(*) from private.bookmark_health_due(now(),500) d join public.bookmarks b on b.id=d.bookmark_id where split_part(b.title,' ',3)::int between 201 and 400),100::bigint,'suspected recheck quota is 100');
select is((select count(*) from private.bookmark_health_due(now(),500) where decision_sample),10::bigint,'at most ten normal audit model samples');
select is((select count(distinct substring(b.url from '^https?://([^/]+)')) from private.bookmark_health_due(now(),500) d join public.bookmarks b on b.id=d.bookmark_id where split_part(b.title,' ',3)::int<=200),10::bigint,'sample distributes over domains');
select is((select count(*) from (select * from private.bookmark_health_due(now(),500) except select * from private.bookmark_health_due(now(),500)) s),0::bigint,'same-day selection is stable');
select is(public.enqueue_bookmark_health_daily(),null::uuid,'disabled scheduler creates no job');
select public.bookmark_health_update_settings(true,500);
select ok(public.enqueue_bookmark_health_daily() is not null,'enabled current-day dispatcher creates work');
select is(public.enqueue_bookmark_health_daily(),null::uuid,'second daily dispatch is idempotent');
select is((select count(*) from public.bookmark_jobs where scope->>'origin'='automatic'),1::bigint,'exactly one daily job');
select is((public.bookmark_command('start',jsonb_build_object('kind','check','scope','selected','ids',jsonb_build_array(md5('health-schedule-401')::uuid)))->>'queuedCount')::int,0,'automatic item is reused by manual start');
select is((select count(*) from public.bookmark_jobs where kind='check' and scope->>'origin'='manual'),0::bigint,'all-reused start makes no fake job');
update public.bookmark_jobs set state='succeeded' where scope->>'origin'='automatic';
select is((public.bookmark_command('start',jsonb_build_object('kind','check','scope','selected','ids',jsonb_build_array(md5('health-schedule-401')::uuid)))->>'queuedCount')::int,1,'manual scope creates one fresh job');
select is((public.bookmark_command('start',jsonb_build_object('kind','check','scope','selected','ids',jsonb_build_array(md5('health-schedule-401')::uuid)))->>'reusedCount')::int,1,'repeated manual scope reuses in-flight work');
select public.bookmark_health_update_settings(false,500);
select is(public.bookmark_health_settings()->>'enabled','false','disable is persisted');
select ok(not has_function_privilege('authenticated','public.enqueue_bookmark_health_daily()','execute'),'owner cannot forge scheduler dates');
select ok(not has_function_privilege('anon','public.bookmark_health_settings()','execute'),'anonymous settings are denied');

select is((select count(*) from private.bookmark_health_due((date_trunc('day',now() at time zone 'Asia/Seoul')+interval '23 hours 59 minutes') at time zone 'Asia/Seoul',500)),500::bigint,'23:59 KST stays in the same daily window');
update public.bookmark_jobs set state='succeeded' where kind='check';
update public.bookmarks set state='trash' where title like 'Health schedule %' and id<>md5('health-schedule-1')::uuid;
update public.bookmark_checks set checked_at=now()-interval '89 days' where bookmark_id=md5('health-schedule-1')::uuid;
select is((select count(*) from private.bookmark_health_due(now(),1)),0::bigint,'normal general recheck waits 90 days');
update public.bookmark_checks set checked_at=now()-interval '90 days' where bookmark_id=md5('health-schedule-1')::uuid;
select is((select count(*) from private.bookmark_health_due(now(),1)),1::bigint,'normal becomes due at 90 days');
update public.bookmark_checks set evidence='{"content":{"status":"unknown"},"media":{"status":"none_detected"}}',checked_at=now()-interval '6 days' where bookmark_id=md5('health-schedule-1')::uuid;
select is((select count(*) from private.bookmark_health_due(now(),1)),0::bigint,'unknown waits seven days');
update public.bookmark_checks set checked_at=now()-interval '7 days' where bookmark_id=md5('health-schedule-1')::uuid;
select is((select count(*) from private.bookmark_health_due(now(),1)),1::bigint,'unknown is due at seven days');
update public.bookmark_checks set evidence='{"content":{"status":"deleted_suspected"},"media":{"status":"none_detected"}}',checked_at=now()-interval '29 days' where bookmark_id=md5('health-schedule-1')::uuid;
select is((select count(*) from private.bookmark_health_due(now(),1)),0::bigint,'suspect general cycle waits 30 days');
update public.bookmark_checks set checked_at=now()-interval '30 days' where bookmark_id=md5('health-schedule-1')::uuid;
select is((select count(*) from private.bookmark_health_due(now(),1)),1::bigint,'suspect general cycle becomes due at 30 days');
select is((select count(*) from private.bookmark_health_due(now()+interval '1 day',1)),1::bigint,'next KST date makes due selection available');
update public.bookmarks set state='trash' where id=md5('health-schedule-1')::uuid;
select is((select count(*) from private.bookmark_health_due(now(),500)),0::bigint,'empty library has no candidates');
select is(public.enqueue_bookmark_health_daily(),null::uuid,'empty library creates no fake automatic job');
select is((select count(*) from cron.job where jobname='applemint-bookmark-worker'),1::bigint,'there is still only one minute dispatcher cron');

select public.bookmark_health_update_settings(true,500);
update public.bookmarks set state='library' where id=md5('health-schedule-1')::uuid;
update public.bookmark_jobs set state='retry',scope=jsonb_set(scope,'{automaticDate}',to_jsonb(((now() at time zone 'Asia/Seoul')::date-1)::text)) where scope->>'origin'='automatic';
select is(public.enqueue_bookmark_health_daily(),null::uuid,'prior page/media/confirmation backlog blocks a new daily job');
update public.bookmark_job_items i set state='waiting',available_at=now()+interval '1 month',work='{"phase":"decision"}' from public.bookmark_jobs j where j.id=i.job_id and j.scope->>'origin'='automatic';
update public.bookmark_jobs set available_at=now()+interval '1 month' where scope->>'origin'='automatic';
insert into public.bookmark_jobs(id,kind,state) values('aaaaaaaa-9900-4000-8000-000000000021','check','succeeded'),('aaaaaaaa-9900-4000-8000-000000000022','check','succeeded'),('aaaaaaaa-9900-4000-8000-000000000023','check','succeeded');
insert into public.bookmark_checks(id,bookmark_id,job_id,bookmark_version,status,reason,checked_url,evidence,checked_at) values
('dddddddd-9900-4000-8000-000000000021',md5('health-schedule-1')::uuid,'aaaaaaaa-9900-4000-8000-000000000021',1,'healthy','old observation','https://site1.example/1','{"coverage":"complete","content":{"status":"unknown"}}',now()-interval '70 days'),
('dddddddd-9900-4000-8000-000000000022',md5('health-schedule-1')::uuid,'aaaaaaaa-9900-4000-8000-000000000022',1,'healthy','normal baseline','https://site1.example/1','{"coverage":"complete","content":{"status":"present"}}',now()-interval '50 days'),
('dddddddd-9900-4000-8000-000000000023',md5('health-schedule-1')::uuid,'aaaaaaaa-9900-4000-8000-000000000023',1,'healthy','event observation','https://site1.example/1','{"coverage":"complete","content":{"status":"unknown"}}',now()-interval '80 days');
insert into public.bookmark_events(bookmark_id,kind,evidence_id) values(md5('health-schedule-1')::uuid,'keep','dddddddd-9900-4000-8000-000000000023');
select ok(public.enqueue_bookmark_health_daily() is not null,'future AI-only wait permits a new current-day page job');
select is((select evidence from public.bookmark_checks where id='dddddddd-9900-4000-8000-000000000021'),null::jsonb,'expired unreferenced payload is cleared');
select ok((select evidence is not null from public.bookmark_checks where id='dddddddd-9900-4000-8000-000000000022'),'normal baseline payload is retained');
select ok((select evidence is not null from public.bookmark_checks where id='dddddddd-9900-4000-8000-000000000023'),'user event evidence is retained');
select is((select reason from public.bookmark_checks where id='dddddddd-9900-4000-8000-000000000021'),'old observation','retention preserves status and reason');
select public.bookmark_health_update_settings(false,500);
select is(public.bookmark_worker_claim(),null::jsonb,'disabling automatic checks prevents new automatic claims');
update public.bookmark_jobs set state='processing',lease_token='cccccccc-9900-4000-8000-000000000001',lease_expires_at=now()+interval '90 seconds' where scope->>'origin'='automatic' and scope->>'automaticDate'=(now() at time zone 'Asia/Seoul')::date::text;
select ok(public.bookmark_worker_commit((select id from public.bookmark_jobs where scope->>'origin'='automatic' and scope->>'automaticDate'=(now() at time zone 'Asia/Seoul')::date::text),'cccccccc-9900-4000-8000-000000000001','{"items":[]}'),'in-flight commit remains valid after disabling automatic work');
select * from finish();rollback;
