begin;
select plan(17);
create temporary table review_group_cases(name text,status text,http_status integer,reason text,evidence jsonb);
insert into review_group_cases values
 ('old healthy','healthy',200,'observed','{"confirmation":"not_required","coverage":"complete","content":{"applicable":true,"status":"present"},"media":{"status":"none_detected","missing":0}}'),
 ('confirmed 404','dead',404,'HTTP 404','{"confirmation":"repeated"}'),
 ('pending 404','dead',404,'HTTP 404','{"confirmation":"pending"}'),
 ('legacy dead','dead',404,'HTTP 404',null),
 ('confirmed DNS','dead',null,'DNS에서 도메인 부재 확인','{"confirmation":"repeated"}'),
 ('confirmed content','healthy',200,'observed','{"confirmation":"repeated","coverage":"complete","content":{"applicable":true,"status":"deleted_suspected"}}'),
 ('limited content','healthy',200,'observed','{"confirmation":"repeated","coverage":"limited","content":{"applicable":true,"status":"deleted_suspected"}}'),
 ('confirmed media','healthy',200,'observed','{"confirmation":"repeated","coverage":"limited","media":{"status":"partial","missing":1}}'),
 ('embed unknown','healthy',200,'observed','{"confirmation":"not_required","media":{"status":"unknown","missing":0}}'),
 ('restricted','restricted',403,'access denied','{}'),
 ('temporary','temporary',503,'timeout','{}'),
 ('no media','healthy',200,'observed','{"confirmation":"not_required","coverage":"complete","content":{"applicable":true,"status":"present"},"media":{"status":"none_detected","missing":0}}'),
 ('stale version','dead',404,'HTTP 404','{"confirmation":"repeated"}'),
 ('reviewed','dead',410,'HTTP 410','{"confirmation":"repeated"}'),
 ('stale url','dead',404,'HTTP 404','{"confirmation":"repeated"}'),
 ('classify','healthy',200,'observed',null),
 ('duplicate one','healthy',200,'observed',null),
 ('duplicate two','healthy',200,'observed',null),
 ('AI organize','healthy',200,'observed',null);
insert into public.bookmarks(id,url,url_key,title,saved_at)
select md5('review-groups-'||name)::uuid,'https://example.com/review-groups/'||replace(name,' ','-'),
 case when name like 'duplicate %' then 'https://example.com/review-groups/duplicate' else 'https://example.com/review-groups/'||replace(name,' ','-') end,
 'Review groups '||name,case when name='old healthy' then now()-interval '200 days' else now() end from review_group_cases;
insert into public.bookmark_jobs(id,kind,state) values(md5('review-groups-job')::uuid,'check','succeeded');
insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,http_status,reason,checked_url,evidence,reviewed_at)
select b.id,md5('review-groups-job')::uuid,case when c.name='stale version' then b.version+1 else b.version end,
 c.status,c.http_status,c.reason,case when c.name='stale url' then 'https://example.com/other' else b.url end,c.evidence,
 case when c.name='reviewed' then now() else null end
from review_group_cases c join public.bookmarks b on b.id=md5('review-groups-'||c.name)::uuid;
insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,reason)
select md5('review-groups-job')::uuid,md5('review-groups-'||name)::uuid,1,case when name='classify' then 'classify' else 'review' end,'Review groups suggestion'
from review_group_cases where name in ('classify','AI organize');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","search":"Review groups "}')->>'total')::int,4,'default group contains only confirmed concrete failures');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","reviewType":"dead","search":"Review groups "}')->>'total')::int,2,'confirmed 404 and NXDOMAIN');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","reviewType":"content","search":"Review groups "}')->>'total')::int,1,'content requires complete coverage and repetition');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","reviewType":"media","search":"Review groups "}')->>'total')::int,1,'actual repeated media loss can have limited overall coverage');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"attention","search":"Review groups "}')->>'total')::int,6,'pending, legacy, limited and access failures require attention');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"organize","search":"Review groups "}')->>'total')::int,4,'age, duplicates and AI review are separate');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"classify","search":"Review groups "}')->>'total')::int,1,'classification remains reachable');
select is((public.bookmark_snapshot('{"review":true,"search":"Review groups "}')->>'total')::int,15,'legacy API keeps the original union');
select is(jsonb_array_length(public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","search":"Review groups ","limit":2,"offset":2}')->'items'),2,'group pagination uses filtered rows');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","search":"Review groups ","limit":2,"offset":2}')->>'total')::int,4,'pagination retains exact group total');
select ok(not exists(select 1 from jsonb_array_elements(public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","search":"Review groups "}')->'items') i where i->>'title' in ('Review groups stale version','Review groups stale url','Review groups reviewed','Review groups old healthy','Review groups no media')),'stale, reviewed and healthy items are excluded');
select throws_ok($$select public.bookmark_snapshot('{"review":true,"reviewGroup":"invalid"}')$$,'22023','invalid review group','invalid DB group rejected');
select lives_ok($$select public.bookmark_command('keep',jsonb_build_object('id',md5('review-groups-confirmed 404')::uuid,'version',1,'evidenceId',(select id from public.bookmark_checks where bookmark_id=md5('review-groups-confirmed 404')::uuid),'evidenceRevision',1))$$,'keep accepts displayed evidence');
select is((public.bookmark_snapshot('{"review":true,"reviewGroup":"problems","search":"Review groups "}')->>'total')::int,3,'keep disappears on authoritative group reload');
select is((public.bookmark_snapshot('{"search":"Review groups confirmed 404"}')->>'total')::int,1,'keep preserves the library bookmark');
select is((public.bookmark_snapshot('{"reviewGroup":"problems"}')->'budget'->>'limit_nano')::bigint,1000000000::bigint,'AI budget unchanged');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$select public.bookmark_snapshot('{"review":true,"reviewGroup":"problems"}')$$,'42501','owner required','owner boundary unchanged');
select * from finish();
rollback;
