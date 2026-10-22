begin;
select plan(10);
select ok((select indisvalid and indisready from pg_index where indexrelid='public.bookmarks_url_idx'::regclass), 'URL hash index is valid and ready');
select ok(not has_function_privilege('anon','public.bookmark_lookup(text)','execute'), 'anonymous cannot call lookup');
select ok(not has_function_privilege('service_role','public.bookmark_lookup(text)','execute'), 'lookup does not need service role access');
insert into public.bookmarks(id,url,url_key,title,state,updated_at,note) values
 ('bbbbbbbb-9700-4000-8000-000000000001','https://example.com/lookup-order','https://example.com/lookup-order','older','library','2026-10-19','keep'),
 ('bbbbbbbb-9700-4000-8000-000000000002','https://example.com/lookup-order','https://example.com/lookup-order','first tie','library','2026-10-20','keep'),
 ('bbbbbbbb-9700-4000-8000-000000000003','https://example.com/lookup-order','https://example.com/lookup-order','newest trash','trash','2026-10-21','keep'),
 ('bbbbbbbb-9700-4000-8000-000000000004','https://example.com/lookup-order','https://example.com/lookup-order','second tie','library','2026-10-20','keep'),
 ('bbbbbbbb-9700-4000-8000-000000000005','https://example.com/lookup-trash','https://example.com/lookup-trash','trash only','trash','2026-10-21','keep');
insert into public.bookmarks(id,url,url_key,note) values ('bbbbbbbb-9700-4000-8000-000000000006',rpad('https://example.com/?q=',8192,'x'),rpad('https://example.com/?q=',8192,'x'),'keep');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is((select id::text from public.bookmark_lookup('https://example.com/lookup-order')),'bbbbbbbb-9700-4000-8000-000000000002','library precedes newer trash and tied timestamps use ascending ID');
reset role;
update public.bookmarks set updated_at='2026-10-22' where id='bbbbbbbb-9700-4000-8000-000000000001';
set local role authenticated;
select is((select id::text from public.bookmark_lookup('https://example.com/lookup-order')),'bbbbbbbb-9700-4000-8000-000000000001','most recently updated library item wins');
select is((select state from public.bookmark_lookup('https://example.com/lookup-trash')),'trash','trash-only match is returned');
select is((select count(*) from public.bookmark_lookup('https://example.com/lookup-absent')),0::bigint,'missing URL returns no rows');
select is((select length(url) from public.bookmark_lookup(rpad('https://example.com/?q=',8192,'x'))),8192,'long URLs are queried through RPC request bodies');
select is((select count(*) from public.bookmarks where id::text like 'bbbbbbbb-9700-%' and note='keep' and version=1),6::bigint,'lookups preserve original records');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.bookmark_lookup('https://example.com/lookup-order')),0::bigint,'non-owner cannot read lookup results through RLS');
reset role;
select * from finish();
rollback;
