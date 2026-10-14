begin;
create function public.bookmark_worker_context()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'importedCount',(select count(*) from public.bookmarks where source_id is not null),
  'collectionCount',(select count(*) from public.bookmark_collections where source_id is not null),
  'missingMembershipCount',(select count(*) from public.bookmarks b where b.source_id is not null
   and not exists(select 1 from public.bookmark_collections c where c.source_id=b.original->'collection'->>'$id')),
  'importCollections',(select coalesce(jsonb_agg(jsonb_build_object('sourceId',source_id,'name',coalesce(original->>'title','미분류'),'parentSourceId',original->>'parentSourceId')),'[]') from public.bookmark_collections where source_id is not null),
  'verifiedCount',(select count(*) from public.bookmark_import_verifications),
  'missingSourceCount',(select count(*) from public.bookmark_import_verifications v where not exists(select 1 from public.bookmarks b where b.source_id=v.source_id)),
  'extraSourceCount',(select count(*) from public.bookmarks b where source_id is not null and not exists(select 1 from public.bookmark_import_verifications v where v.source_id=b.source_id)),
  'changedMembershipCount',(select count(*) from public.bookmark_import_verifications v join public.bookmarks b on b.source_id=v.source_id where b.original->'collection'->>'$id' is distinct from v.collection_source_id),
  'tagCounts',(select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'count',count) order by count desc,tag),'[]')
   from (select tag,count(*) count from public.bookmarks b cross join lateral unnest(b.tags) tag where state='library' group by tag) tags)
 );
$$;
revoke all on function public.bookmark_worker_context() from public,anon,authenticated,service_role;
grant execute on function public.bookmark_worker_context() to service_role;
commit;
