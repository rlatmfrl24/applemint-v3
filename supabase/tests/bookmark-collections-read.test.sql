begin;
select plan(6);
insert into public.bookmark_collections(id,name,archived_at) values
 ('cccccccc-9840-4000-8000-000000000001','Collection active',null),
 ('cccccccc-9840-4000-8000-000000000002','Collection archived',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select is(public.bookmark_collections_snapshot(),public.bookmark_snapshot('{"limit":1}')->'collections','collection-only contract matches existing snapshot');
select ok(public.bookmark_collections_snapshot() @> '[{"id":"cccccccc-9840-4000-8000-000000000001"}]','active collection is reachable');
select ok(not public.bookmark_collections_snapshot() @> '[{"id":"cccccccc-9840-4000-8000-000000000002"}]','archived collection excluded');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok('select public.bookmark_collections_snapshot()','42501','owner required','nonowner cannot read collections');
reset role;
select ok(not has_function_privilege('anon','public.bookmark_collections_snapshot()','execute'),'anonymous collection RPC denied');
select ok(has_function_privilege('authenticated','public.bookmark_collections_snapshot()','execute'),'authenticated owner boundary available');
select * from finish(); rollback;
