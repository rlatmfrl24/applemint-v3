begin;
select plan(9);
insert into public.bookmarks(id,url,url_key,title,saved_at) values
 ('bbbbbbbb-9800-4000-8000-000000000001','https://example.com/cleanup','https://example.com/cleanup','Cleanup QA',now()-interval '200 days');
insert into public.bookmark_jobs(id,kind,state) values
 ('aaaaaaaa-9800-4000-8000-000000000001','classify','succeeded'),
 ('aaaaaaaa-9800-4000-8000-000000000002','check','succeeded');
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,reason)
 values ('aaaaaaaa-9800-4000-8000-000000000001','bbbbbbbb-9800-4000-8000-000000000001',1,'classify','Cleanup classification');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is((public.bookmark_snapshot('{"review":true,"search":"Cleanup QA"}')->>'total')::int,1,'pending classification and old bookmark need review');
select lives_ok($$select public.bookmark_command('keep','{"id":"bbbbbbbb-9800-4000-8000-000000000001","version":1}')$$,'keep preserves the current bookmark');
select is((public.bookmark_snapshot('{"review":true,"search":"Cleanup QA"}')->>'total')::int,0,'keep stays out of review on authoritative reload');
select is((public.bookmark_snapshot('{"review":true,"reviewType":"classify","search":"Cleanup QA"}')->>'total')::int,0,'classification filter also excludes kept items');
select is((public.bookmark_snapshot('{"search":"Cleanup QA"}')->>'total')::int,1,'kept bookmark remains in library');
reset role;
select is((select state from public.bookmark_proposals where bookmark_id='bbbbbbbb-9800-4000-8000-000000000001'),'excluded','keep dismisses classification without applying it');
select ok((select state='library' and version=1 and title='Cleanup QA' and collection_id is null and saved_at=now()-interval '200 days' from public.bookmarks where id='bbbbbbbb-9800-4000-8000-000000000001'),'keep preserves content, state, version and original save date');
insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,reason)
 values ('bbbbbbbb-9800-4000-8000-000000000001','aaaaaaaa-9800-4000-8000-000000000002',1,'dead','New 404 after keep');
set local role authenticated;
select is((public.bookmark_snapshot('{"review":true,"reviewType":"dead","search":"Cleanup QA"}')->>'total')::int,1,'a new failed check can return a kept bookmark to review');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$select public.bookmark_command('keep','{"id":"bbbbbbbb-9800-4000-8000-000000000001","version":1}')$$,'42501','owner required','nonowner still cannot keep');
select * from finish();
rollback;
