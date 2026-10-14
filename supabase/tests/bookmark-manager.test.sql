begin;
select plan(26);
insert into public.bookmark_collections(id,name,parent_id,source_id,original) values
 ('dddddddd-1000-4000-8000-000000000001','Manager QA Parent',null,null,null),
 ('dddddddd-1000-4000-8000-000000000002','Manager QA Target','dddddddd-1000-4000-8000-000000000001','manager-qa-source','{"title":"Original target","parentSourceId":"original-parent"}'),
 ('dddddddd-1000-4000-8000-000000000003','Manager QA Child','dddddddd-1000-4000-8000-000000000002',null,null);
insert into public.bookmarks(id,url,url_key,title,collection_id,state,note,tags,original,saved_at) values
 ('bbbbbbbb-1000-4000-8000-000000000001','https://example.com/manager-member','https://example.com/manager-member','Manager QA Member','dddddddd-1000-4000-8000-000000000002','library','retain note','{tag}','{"retain":true}',now()),
 ('bbbbbbbb-1000-4000-8000-000000000002','https://example.com/manager-trash','https://example.com/manager-trash','Manager QA Trash','dddddddd-1000-4000-8000-000000000002','trash','retain trash','{}',null,now()),
 ('bbbbbbbb-1000-4000-8000-000000000003','https://example.com/manager-dead','https://example.com/manager-dead','Manager QA Dead',null,'library','','{}',null,now()),
 ('bbbbbbbb-1000-4000-8000-000000000004','https://example.com/manager-classify','https://example.com/manager-classify','Manager QA Classify',null,'library','','{}',null,now()),
 ('bbbbbbbb-1000-4000-8000-000000000005','https://example.com/manager-unused','https://example.com/manager-unused','Manager QA Unused',null,'library','','{}',null,now()-interval '200 days');
insert into public.bookmark_jobs(id,kind,state,lease_token,lease_expires_at,total) values
 ('aaaaaaaa-1000-4000-8000-000000000001','classify','processing','cccccccc-1000-4000-8000-000000000001',now()+interval '90 seconds',1),
 ('aaaaaaaa-1000-4000-8000-000000000002','check','succeeded',null,null,1),
 ('aaaaaaaa-1000-4000-8000-000000000003','classify','succeeded',null,null,1);
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values
 ('aaaaaaaa-1000-4000-8000-000000000001','bbbbbbbb-1000-4000-8000-000000000004',1);
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,target_collection_id,reason) values
 ('aaaaaaaa-1000-4000-8000-000000000001','bbbbbbbb-1000-4000-8000-000000000001',1,'classify','dddddddd-1000-4000-8000-000000000002','old destination');
insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,reason) values
 ('bbbbbbbb-1000-4000-8000-000000000003','aaaaaaaa-1000-4000-8000-000000000002',1,'dead','confirmed 404');
insert into public.bookmark_ai_reservations(id,job_id,month,reserved_nano,input_tokens) values
 ('eeeeeeee-1000-4000-8000-000000000001','aaaaaaaa-1000-4000-8000-000000000001',date_trunc('month',now() at time zone 'Asia/Seoul')::date,1000,1);
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select throws_ok($$select public.bookmark_command('collectionRemove','{"id":"dddddddd-1000-4000-8000-000000000002","version":2}')$$,'PT409','collection changed','stale collection deletion rejected');
select lives_ok($$select public.bookmark_command('collectionRemove','{"id":"dddddddd-1000-4000-8000-000000000002","version":1}')$$,'owner removes collection atomically');
reset role;
select ok((select to_jsonb(c)->>'archived_at' is not null from public.bookmark_collections c where id='dddddddd-1000-4000-8000-000000000002'),'deleted record is archived');
select is((select count(*) from public.bookmarks where id in ('bbbbbbbb-1000-4000-8000-000000000001','bbbbbbbb-1000-4000-8000-000000000002') and collection_id is null),2::bigint,'library and trash members become unfiled');
select is((select to_jsonb(b)->>'previous_collection_path' from public.bookmarks b where id='bbbbbbbb-1000-4000-8000-000000000002'),'Manager QA Parent / Manager QA Target','trash retains former hierarchy');
select is((select parent_id from public.bookmark_collections where id='dddddddd-1000-4000-8000-000000000003'),'dddddddd-1000-4000-8000-000000000001'::uuid,'child moves one level up');
select is((select version from public.bookmark_collections where id='dddddddd-1000-4000-8000-000000000003'),2,'reparent invalidates old collection version');
select is((select note from public.bookmarks where id='bbbbbbbb-1000-4000-8000-000000000001'),'retain note','note preserved');
select is((select original from public.bookmarks where id='bbbbbbbb-1000-4000-8000-000000000001'),'{"retain":true}'::jsonb,'bookmark original preserved');
select is((select source_id from public.bookmark_collections where id='dddddddd-1000-4000-8000-000000000002'),'manager-qa-source','source collection remains available for import comparison');
select is((select state from public.bookmark_proposals where bookmark_id='bbbbbbbb-1000-4000-8000-000000000001'),'excluded','pending destination proposal invalidated');
set local role authenticated;
select is((select count(*) from jsonb_array_elements(public.bookmark_snapshot('{}')->'collections') c where c->>'id'='dddddddd-1000-4000-8000-000000000002'),0::bigint,'archived collection absent from owner snapshot');
select throws_ok($$select public.bookmark_command('save','{"url":"https://example.com/manager-archived-save","collectionId":"dddddddd-1000-4000-8000-000000000002"}')$$,'PT409','collection changed','cannot save into archived target');
select throws_ok($$select public.bookmark_command('collectionCreate','{"name":"bad child","parentId":"dddddddd-1000-4000-8000-000000000002"}')$$,'PT409','collection changed','cannot create child of archived target');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$select public.bookmark_command('collectionRemove','{"id":"dddddddd-1000-4000-8000-000000000001","version":1}')$$,'42501','owner required','nonowner cannot remove');
reset role;
select ok(public.bookmark_worker_commit('aaaaaaaa-1000-4000-8000-000000000001','cccccccc-1000-4000-8000-000000000001','{"reservationId":"eeeeeeee-1000-4000-8000-000000000001","reservationState":"settled","chargedNano":100,"outputTokens":1,"items":[{"id":"bbbbbbbb-1000-4000-8000-000000000004","version":1,"proposal":{"collectionId":"dddddddd-1000-4000-8000-000000000002","reason":"arrived after delete"}}]}'::jsonb),'in-flight result commits as failure instead of rolling back');
select is((select state from public.bookmark_job_items where bookmark_id='bbbbbbbb-1000-4000-8000-000000000004'),'failed','deleted AI target fails item');
select is((select state from public.bookmark_ai_reservations where id='eeeeeeee-1000-4000-8000-000000000001'),'settled','invalid destination still settles receipt');
select is((select charged_nano from public.bookmark_ai_reservations where id='eeeeeeee-1000-4000-8000-000000000001'),100::bigint,'known usage retained');
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,reason) values
 ('aaaaaaaa-1000-4000-8000-000000000003','bbbbbbbb-1000-4000-8000-000000000004',1,'classify','new category');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is((public.bookmark_snapshot('{"review":true,"reviewType":"dead","search":"Manager QA"}')->>'total')::int,1,'dead count excludes other result kinds');
select is((public.bookmark_snapshot('{"review":true,"reviewType":"classify","search":"Manager QA"}')->>'total')::int,1,'classify count excludes other result kinds');
select is((public.bookmark_snapshot('{"review":true,"reviewType":"unused","search":"Manager QA"}')->>'total')::int,1,'unused count excludes reviewed/recent items');
select is(public.bookmark_snapshot('{"review":true,"search":"Manager QA","limit":1,"offset":0}')->'items'->0->>'title','Manager QA Dead','dead result first even when newly saved');
select is(public.bookmark_snapshot('{"review":true,"search":"Manager QA","limit":1,"offset":1}')->'items'->0->>'title','Manager QA Classify','classification follows dead before oldest unused');
select lives_ok($$select public.bookmark_command('collectionRemove','{"id":"dddddddd-1000-4000-8000-000000000001","version":1}')$$,'root deletion succeeds');
reset role;
select is((select parent_id from public.bookmark_collections where id='dddddddd-1000-4000-8000-000000000003'),null::uuid,'root child becomes root');
select * from finish();
rollback;
