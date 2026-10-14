begin;
select plan(30);
update public.bookmark_jobs set state='paused';
insert into public.bookmark_jobs(kind,state,progress) values('import','partial','{"page":999,"accountId":"original","phase":"verified"}') on conflict(kind) where kind='import' do update set state='partial',progress=excluded.progress;
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select lives_ok($$select public.bookmark_command('resume',jsonb_build_object('id',(select id from public.bookmark_jobs where kind='import')))$$,'incomplete import resumes');
select is((select progress->>'page' from public.bookmark_jobs where kind='import'),'0','resume rescans from first page');
select is((select progress->>'accountId' from public.bookmark_jobs where kind='import'),'original','rescan retains the original account identity');
reset role;
insert into public.bookmarks(id,url,url_key,title) values('bbbbbbbb-0000-4000-8000-000000000001','https://example.com/review-race','https://example.com/review-race','race');
insert into public.bookmark_jobs(id,kind,state,lease_token,lease_expires_at,total) values('aaaaaaaa-0000-4000-8000-000000000001','review','processing','cccccccc-0000-4000-8000-000000000001',now()+interval '90 seconds',1);
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001',1);
set local role authenticated;
select public.bookmark_command('keep','{"id":"bbbbbbbb-0000-4000-8000-000000000001","version":1}');
reset role;
select public.bookmark_worker_commit('aaaaaaaa-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001',jsonb_build_object('interestVersion',(select interest_version from public.bookmark_settings),'items',jsonb_build_array(jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000001','version',1,'reviewRevision',0,'proposal',jsonb_build_object('reason','old evidence')))));
select is((select count(*) from public.bookmark_proposals where job_id='aaaaaaaa-0000-4000-8000-000000000001'),0::bigint,'late review does not contradict keep');
select is((select state from public.bookmark_job_items where job_id='aaaaaaaa-0000-4000-8000-000000000001'),'failed','changed review evidence remains visible for re-review');

insert into public.bookmark_jobs(id,kind,state,lease_token,lease_expires_at,total) values('aaaaaaaa-0000-4000-8000-000000000002','classify','processing','cccccccc-0000-4000-8000-000000000002',now()+interval '90 seconds',2);
insert into public.bookmarks(id,url,url_key,title) values('bbbbbbbb-0000-4000-8000-000000000002','https://example.com/classify-race','https://example.com/classify-race','race');
insert into public.bookmark_proposals(id,job_id,bookmark_id,expected_version,kind,new_collection_name,reason) values
 ('dddddddd-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001',1,'classify','Boundary new','AI'),
 ('dddddddd-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002',2,'classify','Boundary new','AI');
set local role authenticated;
select throws_ok($$select public.bookmark_command('proposalApply','{"items":[{"id":"dddddddd-0000-4000-8000-000000000001"},{"id":"dddddddd-0000-4000-8000-000000000002"}]}')$$,'PT409','bookmark changed','stale proposal rejects the whole approval');
select is((select count(*) from public.bookmark_collections where name='Boundary new'),0::bigint,'failed approval rolls back collection creation');
select is((select version from public.bookmarks where id='bbbbbbbb-0000-4000-8000-000000000001'),1,'failed approval rolls back the preceding move');
reset role;
update public.bookmark_proposals set expected_version=1 where id='dddddddd-0000-4000-8000-000000000002';
insert into public.bookmark_collections(name) values('Boundary new');
set local role authenticated;
select lives_ok($$select public.bookmark_command('proposalApply','{"items":[{"id":"dddddddd-0000-4000-8000-000000000001"},{"id":"dddddddd-0000-4000-8000-000000000002"}]}')$$,'current proposals apply');
select is((select count(*) from public.bookmark_collections where name='Boundary new'),2::bigint,'new-name approval creates a new collection rather than reusing an existing name');
select is((select count(distinct collection_id) from public.bookmarks where id in ('bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002')),1::bigint,'same job new-name suggestions share the approved collection');
reset role;

delete from public.bookmark_ai_reservations;
select ok(public.bookmark_ai_reserve('eeeeeeee-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',1000,600000000,'openrouter','openai/gpt-6-luna'),'budget reservation succeeds');
select ok(not public.bookmark_ai_reserve('eeeeeeee-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',1000,500000000,'openrouter','openai/gpt-6-luna'),'concurrent sum cannot exceed monthly cap');
select is((select month from public.bookmark_ai_reservations where id='eeeeeeee-0000-4000-8000-000000000001'),date_trunc('month',now() at time zone 'Asia/Seoul')::date,'budget month is KST');
select ok(not public.bookmark_ai_reserve('eeeeeeee-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',1000,1,'openrouter','openai/gpt-6-luna'),'reservation replay cannot reserve twice');
select ok(not public.bookmark_worker_commit('aaaaaaaa-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003','{}'),'wrong lease cannot settle or commit');
select ok(public.bookmark_worker_commit('aaaaaaaa-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002','{"reservationId":"eeeeeeee-0000-4000-8000-000000000001","reservationState":"uncertain","state":"paused"}'),'lost receipt retains the reservation');
select is((select used_nano from jsonb_to_record(public.bookmark_snapshot()->'budget') as budget(used_nano bigint)),600000000::bigint,'uncertain receipt counts the full reserved amount');

update public.bookmark_jobs set state='processing',lease_token='cccccccc-0000-4000-8000-000000000004',lease_expires_at=now()-interval '1 second',available_at=now()-interval '1 second' where id='aaaaaaaa-0000-4000-8000-000000000002';
insert into public.bookmark_ai_reservations(id,job_id,month,reserved_nano,input_tokens) values('eeeeeeee-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000002',date_trunc('month',now() at time zone 'Asia/Seoul')::date,10,1);
update public.bookmark_jobs set state='paused' where id<>'aaaaaaaa-0000-4000-8000-000000000002';
select is(public.bookmark_worker_claim(),null::jsonb,'expired in-flight AI request is not automatically sent again');
select is((select state from public.bookmark_ai_reservations where id='eeeeeeee-0000-4000-8000-000000000004'),'uncertain','crash keeps unconfirmed charge');
select is((select state from public.bookmark_jobs where id='aaaaaaaa-0000-4000-8000-000000000002'),'paused','crash requires explicit resume');

update public.bookmark_jobs set state='processing',lease_token='cccccccc-0000-4000-8000-000000000005',lease_expires_at=now()+interval '90 seconds' where kind='import';
select public.bookmark_worker_commit((select id from public.bookmark_jobs where kind='import'),'cccccccc-0000-4000-8000-000000000005','{"verifyItems":[{"sourceId":"missing-boundary-source","collectionSourceId":"missing-boundary-collection"}]}');
select is((public.bookmark_worker_context()->>'missingSourceCount')::int,1,'verification detects a missing source ID despite equal-count claims');

insert into public.bookmark_jobs(id,kind,state,lease_token,lease_expires_at,total) values('aaaaaaaa-0000-4000-8000-000000000003','review','processing','cccccccc-0000-4000-8000-000000000003',now()+interval '90 seconds',1);
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values('aaaaaaaa-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000002',2);
set local role authenticated;
select public.bookmark_command('open','{"id":"bbbbbbbb-0000-4000-8000-000000000002"}');
reset role;
select public.bookmark_worker_commit('aaaaaaaa-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000003',jsonb_build_object('interestVersion',(select interest_version from public.bookmark_settings),'items',jsonb_build_array(jsonb_build_object('id','bbbbbbbb-0000-4000-8000-000000000002','version',2,'reviewRevision',0,'proposal',jsonb_build_object('reason','old usage')))));
select is((select count(*) from public.bookmark_proposals where job_id='aaaaaaaa-0000-4000-8000-000000000003'),0::bigint,'late review does not ignore an intervening open click');
select is((select state from public.bookmark_job_items where job_id='aaaaaaaa-0000-4000-8000-000000000003'),'failed','late usage evidence is explicitly re-reviewable');
select is((select review_revision from public.bookmarks where id='bbbbbbbb-0000-4000-8000-000000000002'),1,'usage advances the review revision without invalidating classification');

insert into public.bookmark_collections(name,source_id,original) values('미분류','-1','{"parentSourceId":null}') on conflict(source_id) do nothing;
update public.bookmark_jobs set state='processing',lease_token='cccccccc-0000-4000-8000-000000000005',lease_expires_at=now()+interval '90 seconds' where kind='import';
select public.bookmark_worker_commit((select id from public.bookmark_jobs where kind='import'),'cccccccc-0000-4000-8000-000000000005','{"importItems":[{"sourceId":"boundary-duplicate-1","url":"https://example.com/imported-boundary","urlKey":"https://example.com/imported-boundary","title":"First","tags":["original"],"note":"preserve","collectionSourceId":"-1","savedAt":"2020-01-01T00:00:00Z","original":{"collection":{"$id":-1}}},{"sourceId":"boundary-duplicate-2","url":"https://example.com/imported-boundary","urlKey":"https://example.com/imported-boundary","title":"Second","tags":[],"note":"second","collectionSourceId":"-1","savedAt":"2020-01-01T00:00:00Z","original":{"collection":{"$id":-1}}}]}');
select is((select count(*) from public.bookmarks where source_id in ('boundary-duplicate-1','boundary-duplicate-2')),2::bigint,'different imported source IDs preserve duplicate URLs');
select is((select count(*) from public.bookmarks where source_id in ('boundary-duplicate-1','boundary-duplicate-2') and collection_id is null),2::bigint,'imported unsorted uses the same canonical unclassified membership');
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.bookmark_snapshot()->'collections') c where c->>'source_id'='-1'),'UI has one unclassified view rather than a duplicate source collection');
select public.bookmark_command('trash',jsonb_build_object('id',(select id from public.bookmarks where source_id='boundary-duplicate-1'),'version',1));
reset role;
update public.bookmark_jobs set state='processing',lease_token='cccccccc-0000-4000-8000-000000000005',lease_expires_at=now()+interval '90 seconds' where kind='import';
select public.bookmark_worker_commit((select id from public.bookmark_jobs where kind='import'),'cccccccc-0000-4000-8000-000000000005','{"importItems":[{"sourceId":"boundary-duplicate-1","url":"https://example.com/imported-boundary","urlKey":"https://example.com/imported-boundary","title":"Do not overwrite","tags":[],"note":"do not overwrite","collectionSourceId":"-1","savedAt":"2020-01-01T00:00:00Z","original":{"changed":true}}]}');
select ok((select state='trash' and title='First' and note='preserve' and original='{"collection":{"$id":-1}}'::jsonb from public.bookmarks where source_id='boundary-duplicate-1'),'replayed import preserves local trash and original metadata');
update public.bookmark_jobs set state='succeeded' where kind='import';
set local role authenticated;
select throws_ok($$select public.bookmark_command('start','{"kind":"import","confirmed":true}')$$,'PT409','import already completed','completed one-time import cannot start again');
reset role;
select * from finish();
rollback;
