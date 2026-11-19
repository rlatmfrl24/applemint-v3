begin;

create function private.bookmark_is_unique_community_source(p_id uuid,p_source jsonb) returns boolean
language sql stable set search_path='' as $$
 with active as (
  select id,parent_id,lower(btrim(name, E' \t\n\r\v\f' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) as normalized_name
  from public.bookmark_collections
  where archived_at is null and source_id is distinct from '-1'
 )
 select count(*)=1 and coalesce(bool_and(folder.id=p_id),false)
 from active folder join active parent on parent.id=folder.parent_id
 where parent.parent_id is null and parent.normalized_name='community'
  and p_source->>'siteKey' ~ '^[a-z0-9-]+([.][a-z0-9-]+)+$'
  and jsonb_typeof(p_source->'aliases')='array'
  and (
   (p_source->'aliases') ? folder.normalized_name
   or (
    folder.normalized_name ~ '^[a-z0-9-]+([.][a-z0-9-]+)+$'
    and (folder.normalized_name=p_source->>'siteKey'
     or right(folder.normalized_name,length(p_source->>'siteKey')+1)='.'||(p_source->>'siteKey'))
   )
  );
$$;
revoke all on function private.bookmark_is_unique_community_source(uuid,jsonb) from public,anon,authenticated,service_role;

do $$
declare definition text;
 lock_marker text := 'if p_result->>''etcScope'' is not null';
 recommend_marker text := 'when p_result->>''etcScope'' is not null then';
 proposal_marker text := 'when v->''proposal''->>''etcScope'' is not null then';
begin
 definition := pg_get_functiondef('private.bookmark_worker_commit_legacy(uuid,uuid,jsonb)'::regprocedure);
 if position(lock_marker in definition)=0 or position(recommend_marker in definition)=0 or position(proposal_marker in definition)=0 then
  raise exception 'bookmark publication guards changed';
 end if;
 definition := replace(definition,lock_marker,$lock$if p_result->>'sourceRoute' is not null
  or jsonb_path_exists(p_result,'$.items[*].proposal.sourceRoute ? (@ != null)')
  or p_result->>'etcScope' is not null$lock$);
 definition := replace(definition,recommend_marker,$recommend$when p_result->>'sourceRoute' is not null then not private.bookmark_is_unique_community_source((p_result->'recommendation'->>'collectionId')::uuid,p_result->'sourceRoute')
   when p_result->>'etcScope' is not null then$recommend$);
 definition := replace(definition,proposal_marker,$proposal$when v->'proposal'->>'sourceRoute' is not null then not private.bookmark_is_unique_community_source((v->'proposal'->>'collectionId')::uuid,v->'proposal'->'sourceRoute')
   when v->'proposal'->>'etcScope' is not null then$proposal$);
 definition := replace(definition,'etc 컬렉션이 변경되어 다시 추천받아야 합니다.','대상 컬렉션이 변경되어 다시 추천받아야 합니다.');
 definition := replace(definition,'etc 컬렉션이 변경되어 다시 분류해야 합니다.','대상 컬렉션이 변경되어 다시 분류해야 합니다.');
 execute definition;
end $$;

commit;
