begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.threads(id,url,title,host,type,state) values(900000000001119,'https://arca.live/b/test/119','Community post','arca.live','normal','inbox');
insert into public.bookmark_collections(id,name,parent_id) values
 ('dddddddd-1119-4000-8000-000000000001',E'\tEtc ',null),
 ('dddddddd-1119-4000-8000-000000000002','Other',null),
 ('dddddddd-1119-4000-8000-000000000003','ETC','dddddddd-1119-4000-8000-000000000002');
insert into public.bookmarks(id,url,url_key,title) values
 ('bbbbbbbb-1119-4000-8000-000000000001','https://arca.live/b/test/120','https://arca.live/b/test/120','General post');
insert into public.bookmark_jobs(id,kind,state,scope,total,lease_token,lease_expires_at) values
 ('aaaaaaaa-1119-4000-8000-000000000001','recommend','processing','{"threadId":"900000000001119","url":"https://arca.live/b/test/119","sourceTitle":"Community post","officialTitle":null}',1,'cccccccc-1119-4000-8000-000000000001',now()+interval '90 seconds'),
 ('aaaaaaaa-1119-4000-8000-000000000002','classify','processing','{}',1,'cccccccc-1119-4000-8000-000000000002',now()+interval '90 seconds');
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values
 ('aaaaaaaa-1119-4000-8000-000000000002','bbbbbbbb-1119-4000-8000-000000000001',1);
select ok(public.bookmark_ai_reserve('eeeeeeee-1119-4000-8000-000000000001','aaaaaaaa-1119-4000-8000-000000000001','cccccccc-1119-4000-8000-000000000001',65536,2752512,'openrouter','typesafe/jev-1.13'),'recommendation reserves usage');

select ok(public.bookmark_worker_commit('aaaaaaaa-1119-4000-8000-000000000001','cccccccc-1119-4000-8000-000000000001',
 '{"state":"succeeded","completed":1,"reservationId":"eeeeeeee-1119-4000-8000-000000000001","reservationState":"settled","chargedNano":4200,"outputTokens":5,"communityEtc":true,"recommendation":{"collectionId":"dddddddd-1119-4000-8000-000000000001","collectionVersion":1,"basis":"uncertain","confidence":0.6}}'),
 'an in-flight recommendation is finalized after another etc appears');
select is((select state from public.bookmark_jobs where id='aaaaaaaa-1119-4000-8000-000000000001'),'failed','an ambiguous etc cannot become a saved recommendation');
select is((select progress->'recommendation'->>'collectionId' from public.bookmark_jobs where id='aaaaaaaa-1119-4000-8000-000000000001'),null,'no ambiguous target is published');
select is((select charged_nano from public.bookmark_ai_reservations where id='eeeeeeee-1119-4000-8000-000000000001'),4200::bigint,'the invalidated result still settles its provider receipt');

update public.bookmark_collections set name='Renamed',version=2 where id='dddddddd-1119-4000-8000-000000000001';
select ok(public.bookmark_worker_commit('aaaaaaaa-1119-4000-8000-000000000002','cccccccc-1119-4000-8000-000000000002',
 '{"items":[{"id":"bbbbbbbb-1119-4000-8000-000000000001","version":1,"result":{"reason":"community fallback"},"proposal":{"collectionId":"dddddddd-1119-4000-8000-000000000001","communityEtc":true,"reason":"community fallback"}}]}'),
 'the batch is finalized after the proposed etc is renamed');
select is((select count(*) from public.bookmark_proposals where job_id='aaaaaaaa-1119-4000-8000-000000000002'),0::bigint,'the renamed destination is never proposed');
select is((select state from public.bookmark_job_items where job_id='aaaaaaaa-1119-4000-8000-000000000002'),'failed','the affected item can be reclassified');
select * from finish();
rollback;
