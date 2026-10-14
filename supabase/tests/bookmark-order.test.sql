begin;
select plan(25);
insert into public.bookmark_collections(id,name,parent_id,source_id,original,archived_at) values
 ('dddddddd-5000-4000-8000-000000000001','Order parent',null,null,null,null),
 ('dddddddd-5000-4000-8000-000000000002','Order A','dddddddd-5000-4000-8000-000000000001','order-original','{"original":"retained"}',null),
 ('dddddddd-5000-4000-8000-000000000003','Order B','dddddddd-5000-4000-8000-000000000001',null,null,null),
 ('dddddddd-5000-4000-8000-000000000004','Order C','dddddddd-5000-4000-8000-000000000001',null,null,null),
 ('dddddddd-5000-4000-8000-000000000005','Order other parent',null,null,null,null),
 ('dddddddd-5000-4000-8000-000000000006','Order grandchild','dddddddd-5000-4000-8000-000000000002',null,null,null),
 ('dddddddd-5000-4000-8000-000000000007','Order archived','dddddddd-5000-4000-8000-000000000001',null,null,now());
set local role authenticated;
select set_config('request.jwt.claim.sub','480f5282-7933-4800-a970-d6bc8f05e8cb',true);
select lives_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":1,"targetId":"dddddddd-5000-4000-8000-000000000002","targetVersion":1,"position":"before"}')$$,'insert before sibling');
select is((select string_agg(name,',' order by sort_order,id) from public.bookmark_collections where parent_id='dddddddd-5000-4000-8000-000000000001' and archived_at is null),'Order C,Order A,Order B','saved sibling order');
select is((select count(*) from public.bookmark_collections where parent_id='dddddddd-5000-4000-8000-000000000001' and archived_at is null and version=2),3::bigint,'every sibling version advances atomically');
select is((select original from public.bookmark_collections where id='dddddddd-5000-4000-8000-000000000002'),'{"original":"retained"}'::jsonb,'import record preserved');
select is((select parent_id from public.bookmark_collections where id='dddddddd-5000-4000-8000-000000000006'),'dddddddd-5000-4000-8000-000000000002'::uuid,'subtree preserved');
select lives_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":2,"targetId":"dddddddd-5000-4000-8000-000000000002","targetVersion":2,"position":"before"}')$$,'already adjacent is a no-op');
select is((select version from public.bookmark_collections where id='dddddddd-5000-4000-8000-000000000004'),2,'no-op keeps versions');
select lives_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":2,"targetId":"dddddddd-5000-4000-8000-000000000003","targetVersion":2,"position":"after"}')$$,'insert after sibling');
select is((select string_agg(name,',' order by sort_order,id) from public.bookmark_collections where parent_id='dddddddd-5000-4000-8000-000000000001' and archived_at is null),'Order A,Order B,Order C','after order persisted');
select is((select string_agg(value->>'name',',' order by ordinal) from jsonb_array_elements(public.bookmark_snapshot('{"limit":1}')->'collections') with ordinality as c(value,ordinal) where value->>'parent_id'='dddddddd-5000-4000-8000-000000000001'),'Order A,Order B,Order C','user snapshot follows saved order');
select throws_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":2,"targetId":"dddddddd-5000-4000-8000-000000000002","targetVersion":3,"position":"before"}')$$,'PT409','collection changed','stale source rejected');
select throws_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":3,"targetId":"dddddddd-5000-4000-8000-000000000002","targetVersion":2,"position":"before"}')$$,'PT409','collection changed','stale anchor rejected');
select throws_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":3,"targetId":"dddddddd-5000-4000-8000-000000000005","targetVersion":1,"position":"before"}')$$,'22023','collections must be siblings','different levels rejected');
select throws_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":3,"targetId":"dddddddd-5000-4000-8000-000000000004","targetVersion":3,"position":"after"}')$$,'22023','invalid reorder target','self rejected');
select throws_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":3,"targetId":"dddddddd-5000-4000-8000-000000000007","targetVersion":1,"position":"before"}')$$,'PT409','collection changed','archived anchor rejected');
select throws_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":3,"targetId":"dddddddd-5000-4000-8000-000000000002","targetVersion":3,"position":"inside"}')$$,'22023','invalid reorder position','nesting uses separate move command');
select lives_ok($$select public.bookmark_command('collectionCreate','{"name":"Order Z","parentId":"dddddddd-5000-4000-8000-000000000001"}')$$,'new collection appends');
select is((select string_agg(name,',' order by sort_order,id) from public.bookmark_collections where parent_id='dddddddd-5000-4000-8000-000000000001' and archived_at is null),'Order A,Order B,Order C,Order Z','creation preserves manual order');
select lives_ok($$select public.bookmark_command('collectionMove','{"id":"dddddddd-5000-4000-8000-000000000005","version":1,"parentId":"dddddddd-5000-4000-8000-000000000001"}')$$,'reparent appends after ordered siblings');
select is((select name from public.bookmark_collections where parent_id='dddddddd-5000-4000-8000-000000000001' and archived_at is null order by sort_order desc,id desc limit 1),'Order other parent','reparent position persisted');
select lives_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":3,"targetId":"dddddddd-5000-4000-8000-000000000002","targetVersion":3,"position":"before"}')$$,'custom child order before parent deletion');
set local enable_indexscan=off;
set local enable_bitmapscan=off;
select lives_ok($$select public.bookmark_command('collectionRemove','{"id":"dddddddd-5000-4000-8000-000000000001","version":1}')$$,'delete parent promotes ordered children');
select is((select string_agg(name,',' order by sort_order,id) from public.bookmark_collections where name in ('Order A','Order B','Order C','Order Z','Order other parent') and parent_id is null),'Order C,Order A,Order B,Order Z,Order other parent','promotion preserves former sibling order');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$select public.bookmark_command('collectionReorder','{"id":"dddddddd-5000-4000-8000-000000000004","version":3,"targetId":"dddddddd-5000-4000-8000-000000000002","targetVersion":3,"position":"before"}')$$,'42501','owner required','owner boundary retained');
reset role;
select ok(not has_function_privilege('authenticated','private.bookmark_reorder(jsonb)','EXECUTE'),'private helper cannot bypass owner RPC');
select * from finish();
rollback;
