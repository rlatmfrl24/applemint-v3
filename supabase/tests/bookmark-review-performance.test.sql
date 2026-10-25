begin;
select plan(5);
set local track_functions='all';
insert into public.bookmarks(id,url,url_key,title,saved_at)
select md5('review-scale-'||n)::uuid,'https://example.com/review-scale/'||n,'https://example.com/review-scale/'||n,'Review scale '||n,now()-interval '1 year'
from generate_series(1,33000) n;
insert into public.bookmark_jobs(id,kind,state) values('aaaaaaaa-9820-4000-8000-000000000001','check','succeeded');
insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,reason,checked_url,evidence)
select b.id,'aaaaaaaa-9820-4000-8000-000000000001',b.version,'healthy','observed',b.url,
jsonb_build_object('content',jsonb_build_object('status','present','excerpt',repeat('x',1800)),'media',jsonb_build_object('status','present'),'coverage','complete')
from public.bookmarks b where b.title like 'Review scale %' order by b.id limit 1500;
analyze public.bookmarks;
analyze public.bookmark_checks;
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
create temporary table review_scale_response as select public.bookmark_snapshot('{"review":true,"search":"Review scale ","limit":100,"offset":100}') value;
reset role;
select is((select (value->>'total')::int from review_scale_response),33000,'all old candidates counted before pagination');
select is((select jsonb_array_length(value->'items') from review_scale_response),100,'later page contains requested size');
select ok(coalesce((select calls from pg_stat_xact_user_functions where funcid='private.bookmark_health_matches(public.bookmark_checks,text)'::regprocedure),0)<=6000,'classification work scales with latest observations, not unchecked bookmarks or repeated filters');
select ok(not exists(select 1 from review_scale_response,jsonb_array_elements(value->'items') item where item->'check' is distinct from 'null'::jsonb and not (item->'check' ? 'evidence')),'raw check response retains evidence contract');
select is((select (value->'budget'->>'limit_nano')::bigint from review_scale_response),1000000000::bigint,'shared monthly AI cap unchanged');
select * from finish();
rollback;
