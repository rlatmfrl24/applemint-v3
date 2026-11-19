begin;
select plan(10);

insert into public.threads(id,url,title,host,type,state) values(900000000001120,'https://arca.live/b/test/120','Community post','arca.live','normal','inbox');
insert into public.bookmark_collections(id,name,parent_id) values
 ('dddddddd-1120-4000-8000-000000000001',E'\tEtc ',null),
 ('dddddddd-1120-4000-8000-000000000002',' Community ',null),
 ('dddddddd-1120-4000-8000-000000000003','ETC','dddddddd-1120-4000-8000-000000000002');
insert into public.bookmarks(id,url,url_key,title) values
 ('bbbbbbbb-1120-4000-8000-000000000001','https://example.org/garden','https://example.org/garden','Garden note');
insert into public.bookmark_jobs(id,kind,state,scope,total,lease_token,lease_expires_at) values
 ('aaaaaaaa-1120-4000-8000-000000000001','recommend','processing','{"threadId":"900000000001120","url":"https://arca.live/b/test/120","sourceTitle":"Community post","officialTitle":null}',1,'cccccccc-1120-4000-8000-000000000001',now()+interval '90 seconds'),
 ('aaaaaaaa-1120-4000-8000-000000000002','classify','processing','{}',1,'cccccccc-1120-4000-8000-000000000002',now()+interval '90 seconds'),
 ('aaaaaaaa-1120-4000-8000-000000000003','classify','processing','{}',1,'cccccccc-1120-4000-8000-000000000003',now()+interval '90 seconds');
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values
 ('aaaaaaaa-1120-4000-8000-000000000002','bbbbbbbb-1120-4000-8000-000000000001',1),
 ('aaaaaaaa-1120-4000-8000-000000000003','bbbbbbbb-1120-4000-8000-000000000001',1);
select ok(public.bookmark_ai_reserve('eeeeeeee-1120-4000-8000-000000000001','aaaaaaaa-1120-4000-8000-000000000003','cccccccc-1120-4000-8000-000000000003',128000,20096000,'openrouter','openai/gpt-6-luna'),'classification reserves usage');

select ok(public.bookmark_worker_commit('aaaaaaaa-1120-4000-8000-000000000001','cccccccc-1120-4000-8000-000000000001',
 '{"state":"succeeded","completed":1,"etcScope":"community","recommendation":{"collectionId":"dddddddd-1120-4000-8000-000000000003","collectionVersion":1,"basis":"uncertain","confidence":0.6}}'),
 'worker finalizes the community recommendation');
select is((select state from public.bookmark_jobs where id='aaaaaaaa-1120-4000-8000-000000000001'),'succeeded','the unrelated root etc does not block the community route');
select is((select progress->'recommendation'->>'collectionId' from public.bookmark_jobs where id='aaaaaaaa-1120-4000-8000-000000000001'),'dddddddd-1120-4000-8000-000000000003','the recommendation keeps the community ID');

select ok(public.bookmark_worker_commit('aaaaaaaa-1120-4000-8000-000000000002','cccccccc-1120-4000-8000-000000000002',
 '{"items":[{"id":"bbbbbbbb-1120-4000-8000-000000000001","version":1,"proposal":{"collectionId":"dddddddd-1120-4000-8000-000000000001","etcScope":"root","reason":"miscellaneous site"}}]}'),
 'worker finalizes the root etc proposal');
select is((select target_collection_id::text from public.bookmark_proposals where job_id='aaaaaaaa-1120-4000-8000-000000000002'),'dddddddd-1120-4000-8000-000000000001','the unrelated nested etc does not block the root proposal');

update public.bookmark_collections set parent_id='dddddddd-1120-4000-8000-000000000002' where id='dddddddd-1120-4000-8000-000000000001';
select ok(public.bookmark_worker_commit('aaaaaaaa-1120-4000-8000-000000000003','cccccccc-1120-4000-8000-000000000003',
 '{"reservationId":"eeeeeeee-1120-4000-8000-000000000001","reservationState":"settled","chargedNano":4200,"outputTokens":5,"items":[{"id":"bbbbbbbb-1120-4000-8000-000000000001","version":1,"proposal":{"collectionId":"dddddddd-1120-4000-8000-000000000001","etcScope":"root","reason":"miscellaneous site"}}]}'),
 'worker records the result after the root target moves');
select is((select count(*) from public.bookmark_proposals where job_id='aaaaaaaa-1120-4000-8000-000000000003'),0::bigint,'an etc moved out of the selected path is never proposed');
select is((select state from public.bookmark_job_items where job_id='aaaaaaaa-1120-4000-8000-000000000003'),'failed','the affected item can be retried');
select is((select charged_nano from public.bookmark_ai_reservations where id='eeeeeeee-1120-4000-8000-000000000001'),4200::bigint,'the known charge is still settled');
select * from finish();
rollback;
