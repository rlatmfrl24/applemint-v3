begin;
select plan(8);
insert into public.bookmark_jobs(id,kind,state) values
 ('aaaaaaaa-9400-4000-8000-000000000001','classify','succeeded'),
 ('aaaaaaaa-9400-4000-8000-000000000002','review','succeeded');
insert into public.bookmarks(id,url,url_key,title,note,tags)
 select ('bbbbbbbb-9400-4000-8000-'||lpad(n::text,12,'0'))::uuid,'https://example.com/exclude/'||n,'https://example.com/exclude/'||n,'Exclude QA '||n,'retain note','{tag}' from generate_series(1,1001) n;
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,reason)
 select j.id,b.id,b.version,j.kind,'Exclude QA' from public.bookmarks b cross join public.bookmark_jobs j
 where b.id::text like 'bbbbbbbb-9400-%' and j.id::text like 'aaaaaaaa-9400-%';
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
select throws_ok($$select public.bookmark_command('proposalExclude','{"items":[]}')$$,'42501','owner required','nonowner cannot exclude proposals');
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select throws_ok($$select public.bookmark_command('proposalExclude',jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',id,'version',case when id='bbbbbbbb-9400-4000-8000-000000001001' then version+1 else version end)) from public.bookmarks where id::text like 'bbbbbbbb-9400-%')))$$,'PT409','bookmark changed','a stale final bookmark rejects the entire exclusion');
select is((select count(*) from public.bookmark_proposals where job_id::text like 'aaaaaaaa-9400-%' and state='pending'),2002::bigint,'no earlier proposals changed after stale batch failure');
select is((public.bookmark_command('proposalExclude',jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',id,'version',version)) from public.bookmarks where id::text like 'bbbbbbbb-9400-%')))->>'applied')::int,2002,'1001 selected bookmarks exclude all 2002 proposals atomically');
select is((select count(*) from public.bookmark_proposals where job_id::text like 'aaaaaaaa-9400-%' and state='pending'),0::bigint,'all kinds of pending proposals are excluded');
select is((select count(*) from public.bookmarks where id::text like 'bbbbbbbb-9400-%' and state='library' and version=1 and note='retain note' and tags='{tag}'),1001::bigint,'bookmark membership content and version are preserved');
select throws_ok($$select public.bookmark_command('proposalExclude','{"items":[]}')$$,'22023','invalid exclusion items','empty batches are rejected at the DB boundary');
select throws_ok($$select public.bookmark_command('proposalExclude','{"items":[{"id":"bbbbbbbb-9400-4000-8000-000000000001","version":1},{"id":"bbbbbbbb-9400-4000-8000-000000000001","version":1}]}')$$,'22023','invalid exclusion items','duplicate bookmarks are rejected');
select * from finish();
rollback;
