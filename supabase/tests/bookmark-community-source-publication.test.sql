begin;
select plan(7);

insert into public.threads(id,url,title,host,type,state) values
 (900000000001122,'https://bbs.ruliweb.com/community/board/300143/read/123','Community post','ruliweb.com','normal','inbox');
insert into public.bookmark_collections(id,name,parent_id) values
 ('dddddddd-1122-4000-8000-000000000001','Community',null),
 ('dddddddd-1122-4000-8000-000000000002',' bbs.ruliweb.com ','dddddddd-1122-4000-8000-000000000001'),
 ('dddddddd-1122-4000-8000-000000000003','ruliweb',null);
insert into public.bookmarks(id,url,url_key,title) values
 ('bbbbbbbb-1122-4000-8000-000000000001','https://bbs.ruliweb.com/community/board/300143/read/123','https://bbs.ruliweb.com/community/board/300143/read/123','Community post');
insert into public.bookmark_jobs(id,kind,state,scope,total,lease_token,lease_expires_at) values
 ('aaaaaaaa-1122-4000-8000-000000000001','recommend','processing','{"threadId":"900000000001122","url":"https://bbs.ruliweb.com/community/board/300143/read/123","sourceTitle":"Community post","officialTitle":null}',1,'cccccccc-1122-4000-8000-000000000001',now()+interval '90 seconds'),
 ('aaaaaaaa-1122-4000-8000-000000000002','classify','processing','{}',1,'cccccccc-1122-4000-8000-000000000002',now()+interval '90 seconds');
insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values
 ('aaaaaaaa-1122-4000-8000-000000000002','bbbbbbbb-1122-4000-8000-000000000001',1);
select ok(public.bookmark_ai_reserve('eeeeeeee-1122-4000-8000-000000000001','aaaaaaaa-1122-4000-8000-000000000002','cccccccc-1122-4000-8000-000000000002',128000,20096000,'openrouter','openai/gpt-6-luna'),'classification reserves usage');

select ok(public.bookmark_worker_commit('aaaaaaaa-1122-4000-8000-000000000001','cccccccc-1122-4000-8000-000000000001',
 '{"state":"succeeded","completed":1,"sourceRoute":{"siteKey":"ruliweb.com","aliases":["ruliweb","루리웹"]},"recommendation":{"collectionId":"dddddddd-1122-4000-8000-000000000002","collectionVersion":1,"basis":"uncertain","confidence":0.6}}'),
 'the worker finalizes a valid community source recommendation');
select is((select progress->'recommendation'->>'collectionId' from public.bookmark_jobs where id='aaaaaaaa-1122-4000-8000-000000000001'),'dddddddd-1122-4000-8000-000000000002','a same-name source outside Community does not block the recommendation');

update public.bookmark_collections set parent_id='dddddddd-1122-4000-8000-000000000001' where id='dddddddd-1122-4000-8000-000000000003';
select ok(public.bookmark_worker_commit('aaaaaaaa-1122-4000-8000-000000000002','cccccccc-1122-4000-8000-000000000002',
 '{"reservationId":"eeeeeeee-1122-4000-8000-000000000001","reservationState":"settled","chargedNano":4200,"outputTokens":5,"items":[{"id":"bbbbbbbb-1122-4000-8000-000000000001","version":1,"proposal":{"collectionId":"dddddddd-1122-4000-8000-000000000002","sourceRoute":{"siteKey":"ruliweb.com","aliases":["ruliweb","루리웹"]},"reason":"community source"}}]}'),
 'the worker records the result after a second alias joins the source route');
select is((select count(*) from public.bookmark_proposals where job_id='aaaaaaaa-1122-4000-8000-000000000002'),0::bigint,'an ambiguous source is never proposed');
select is((select state from public.bookmark_job_items where job_id='aaaaaaaa-1122-4000-8000-000000000002'),'failed','an invalidated source can be recomputed');
select is((select charged_nano from public.bookmark_ai_reservations where id='eeeeeeee-1122-4000-8000-000000000001'),4200::bigint,'the worker still settles known usage');
select * from finish();
rollback;
