begin;
select plan(17);
insert into public.bookmarks(id,url,url_key,title) values
 ('bbbbbbbb-9700-4000-8000-000000000001','https://example.com/health-a','https://example.com/health-a','Health A'),
 ('bbbbbbbb-9700-4000-8000-000000000002','https://example.com/health-b','https://example.com/health-b','Health B'),
 ('bbbbbbbb-9700-4000-8000-000000000003','https://example.com/health-c','https://example.com/health-c','Health C');
insert into public.bookmark_jobs(id,kind,state) values ('aaaaaaaa-9700-4000-8000-000000000001','check','succeeded');
insert into public.bookmark_checks(id,bookmark_id,job_id,bookmark_version,status,reason,checked_url,evidence) values
 ('dddddddd-9700-4000-8000-000000000001','bbbbbbbb-9700-4000-8000-000000000001','aaaaaaaa-9700-4000-8000-000000000001',1,'healthy','content suspicion','https://example.com/health-a','{"content":{"applicable":true,"status":"deleted_suspected"},"media":{"status":"not_checked"}}'),
 ('dddddddd-9700-4000-8000-000000000002','bbbbbbbb-9700-4000-8000-000000000002','aaaaaaaa-9700-4000-8000-000000000001',1,'healthy','media partial','https://example.com/health-b','{"content":{"applicable":true,"status":"present"},"media":{"applicable":true,"status":"partial"}}'),
 ('dddddddd-9700-4000-8000-000000000003','bbbbbbbb-9700-4000-8000-000000000003','aaaaaaaa-9700-4000-8000-000000000001',1,'healthy','direct media','https://example.com/health-c','{"content":{"applicable":false,"status":"not_checked"},"media":{"applicable":true,"status":"present"}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is((public.bookmark_snapshot('{"review":true,"reviewType":"content","search":"Health "}')->>'total')::int,1,'content candidate count');
select is((public.bookmark_snapshot('{"review":true,"reviewType":"media","search":"Health "}')->'items'->0->>'id'),'bbbbbbbb-9700-4000-8000-000000000002','media page agrees with count');
select is((public.bookmark_snapshot('{"review":true,"reviewType":"uncheckable","search":"Health "}')->>'total')::int,0,'direct media not false unknown');
select throws_ok($$select public.bookmark_command('keep','{"id":"bbbbbbbb-9700-4000-8000-000000000001","version":1}')$$,'PT409','health evidence changed','health keep requires displayed evidence');
select throws_ok($$select public.bookmark_command('keep','{"id":"bbbbbbbb-9700-4000-8000-000000000001","version":1,"evidenceId":"dddddddd-9700-4000-8000-000000000002","evidenceRevision":1}')$$,'PT409','health evidence changed','other bookmark evidence rejected');
reset role;
update public.bookmark_checks set evidence_revision=2 where id='dddddddd-9700-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.bookmark_command('keep','{"id":"bbbbbbbb-9700-4000-8000-000000000001","version":1,"evidenceId":"dddddddd-9700-4000-8000-000000000001","evidenceRevision":1}')$$,'PT409','health evidence changed','same ID newer revision rejected');
select lives_ok($$select public.bookmark_command('keep','{"id":"bbbbbbbb-9700-4000-8000-000000000001","version":1,"evidenceId":"dddddddd-9700-4000-8000-000000000001","evidenceRevision":2}')$$,'displayed current evidence can be kept');
select is((public.bookmark_snapshot('{"review":true,"reviewType":"content","search":"Health "}')->>'total')::int,0,'reviewed candidate disappears');
reset role;
update public.bookmarks set version=2 where id='bbbbbbbb-9700-4000-8000-000000000002';
set local role authenticated;
select is((public.bookmark_snapshot('{"review":true,"reviewType":"media","search":"Health "}')->>'total')::int,0,'stale version is not a candidate');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$select public.bookmark_snapshot('{"reviewType":"media"}')$$,'42501','owner required','nonowner cannot read');
select throws_ok($$select public.bookmark_command('keep','{"id":"bbbbbbbb-9700-4000-8000-000000000003","version":1}')$$,'42501','owner required','nonowner cannot mutate');
reset role;
select is((select health_daily_limit from public.bookmark_settings),500,'default daily limit');
select is((select health_auto_enabled from public.bookmark_settings),false,'default automatic off');
select throws_ok($$update public.bookmark_settings set health_daily_limit=1001$$,'23514',null,'daily upper bound');
select throws_ok($$update public.bookmark_settings set health_daily_limit=0$$,'23514',null,'daily lower bound');
select ok((select reviewed_at is not null from public.bookmark_checks where id='dddddddd-9700-4000-8000-000000000001'),'exact evidence recorded reviewed');
select is((select state from public.bookmarks where id='bbbbbbbb-9700-4000-8000-000000000001'),'library','checks do not delete bookmarks');
select * from finish();
rollback;
