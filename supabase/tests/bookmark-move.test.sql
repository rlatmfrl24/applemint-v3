begin;
select plan(26);
insert into public.bookmark_collections(id,name,parent_id,source_id,original,archived_at) values
 ('dddddddd-3000-4000-8000-000000000001','Move root A',null,null,null,null),
 ('dddddddd-3000-4000-8000-000000000002','Move root B',null,null,null,null),
 ('dddddddd-3000-4000-8000-000000000003','Move child','dddddddd-3000-4000-8000-000000000001','move-origin','{"parent":"original"}',null),
 ('dddddddd-3000-4000-8000-000000000004','Move grandchild','dddddddd-3000-4000-8000-000000000003',null,null,null),
 ('dddddddd-3000-4000-8000-000000000005','Archived destination',null,null,null,now());
insert into public.bookmarks(id,url,url_key,note,collection_id,state) values
 ('bbbbbbbb-3000-4000-8000-000000000001','https://example.com/move-one','https://example.com/move-one','retain one','dddddddd-3000-4000-8000-000000000001','library'),
 ('bbbbbbbb-3000-4000-8000-000000000002','https://example.com/move-two','https://example.com/move-two','retain two','dddddddd-3000-4000-8000-000000000001','library'),
 ('bbbbbbbb-3000-4000-8000-000000000003','https://example.com/move-trash','https://example.com/move-trash','retain trash',null,'trash');
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select lives_ok($$select public.bookmark_command('bulkMove','{"items":[{"id":"bbbbbbbb-3000-4000-8000-000000000002","version":1},{"id":"bbbbbbbb-3000-4000-8000-000000000001","version":1}],"collectionId":"dddddddd-3000-4000-8000-000000000002"}')$$,'two selected bookmarks move together');
select is((select count(*) from public.bookmarks where id in ('bbbbbbbb-3000-4000-8000-000000000001','bbbbbbbb-3000-4000-8000-000000000002') and collection_id='dddddddd-3000-4000-8000-000000000002'),2::bigint,'all requested memberships changed');
select is((select note from public.bookmarks where id='bbbbbbbb-3000-4000-8000-000000000001'),'retain one','move preserves notes');
select is((select previous_collection_path from public.bookmarks where id='bbbbbbbb-3000-4000-8000-000000000002'),'Move root A','former path preserved');
select lives_ok($$select public.bookmark_command('bulkMove','{"items":[{"id":"bbbbbbbb-3000-4000-8000-000000000001","version":2}],"collectionId":"dddddddd-3000-4000-8000-000000000002"}')$$,'same destination is a no-op');
select is((select version from public.bookmarks where id='bbbbbbbb-3000-4000-8000-000000000001'),2,'same destination preserves version');
select throws_ok($$select public.bookmark_command('bulkMove','{"items":[{"id":"bbbbbbbb-3000-4000-8000-000000000001","version":2},{"id":"bbbbbbbb-3000-4000-8000-000000000002","version":1}],"collectionId":null}')$$,'PT409','bookmark changed','one stale member rejects entire batch');
select is((select count(*) from public.bookmarks where id in ('bbbbbbbb-3000-4000-8000-000000000001','bbbbbbbb-3000-4000-8000-000000000002') and collection_id='dddddddd-3000-4000-8000-000000000002'),2::bigint,'failed batch leaves every membership intact');
select throws_ok($$select public.bookmark_command('bulkMove','{"items":[],"collectionId":null}')$$,'22023','invalid move items','empty batch rejected');
select throws_ok($$select public.bookmark_command('bulkMove','{"items":[{"id":"bbbbbbbb-3000-4000-8000-000000000001","version":2},{"id":"bbbbbbbb-3000-4000-8000-000000000001","version":2}],"collectionId":null}')$$,'22023','invalid move items','duplicate items rejected');
select throws_ok($$select public.bookmark_command('bulkMove','{"items":[{"id":"bbbbbbbb-3000-4000-8000-000000000003","version":1}],"collectionId":null}')$$,'PT409','bookmark changed','trash cannot enter selection move');
select throws_ok($$select public.bookmark_command('bulkMove','{"items":[{"id":"bbbbbbbb-3000-4000-8000-000000000001","version":2}],"collectionId":"dddddddd-3000-4000-8000-000000000005"}')$$,'PT409','collection changed','archived batch target rejected');
select lives_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-3000-4000-8000-000000000003","version":1,"parentId":"dddddddd-3000-4000-8000-000000000002"}')$$,'collection moves with subtree');
select is((select parent_id from public.bookmark_collections where id='dddddddd-3000-4000-8000-000000000003'),'dddddddd-3000-4000-8000-000000000002'::uuid,'collection has requested parent');
select is((select parent_id from public.bookmark_collections where id='dddddddd-3000-4000-8000-000000000004'),'dddddddd-3000-4000-8000-000000000003'::uuid,'grandchild stays with moved subtree');
select is((select original from public.bookmark_collections where id='dddddddd-3000-4000-8000-000000000003'),'{"parent":"original"}'::jsonb,'import hierarchy record preserved');
select throws_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-3000-4000-8000-000000000003","version":2,"parentId":"dddddddd-3000-4000-8000-000000000003"}')$$,'22023','collection cycle','self parent rejected');
select throws_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-3000-4000-8000-000000000003","version":2,"parentId":"dddddddd-3000-4000-8000-000000000004"}')$$,'22023','collection cycle','descendant parent rejected');
select throws_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-3000-4000-8000-000000000003","version":1,"parentId":null}')$$,'PT409','collection changed','stale reparent rejected');
select throws_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-3000-4000-8000-000000000003","version":2,"parentId":"dddddddd-3000-4000-8000-000000000005"}')$$,'PT409','collection changed','archived parent rejected');
select lives_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-3000-4000-8000-000000000003","version":2,"parentId":null}')$$,'child can become root');
select is((select parent_id from public.bookmark_collections where id='dddddddd-3000-4000-8000-000000000003'),null::uuid,'root move persisted');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-3000-4000-8000-000000000003","version":3,"parentId":null}')$$,'42501','owner required','nonowner cannot move collections');
select throws_ok($$select public.bookmark_command('bulkMove','{"items":[{"id":"bbbbbbbb-3000-4000-8000-000000000001","version":2}],"collectionId":null}')$$,'42501','owner required','nonowner cannot move a batch');
reset role;
select ok(not has_function_privilege('authenticated','private.bookmark_move_many(jsonb)','EXECUTE'),'batch helper cannot bypass owner RPC');
select ok(not has_function_privilege('authenticated','private.bookmark_reparent(jsonb)','EXECUTE'),'hierarchy helper cannot bypass owner RPC');
select * from finish();
rollback;
