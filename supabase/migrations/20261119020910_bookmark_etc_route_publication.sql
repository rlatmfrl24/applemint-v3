begin;

create function private.bookmark_is_unique_etc_on_route(p_id uuid,p_scope text) returns boolean
language sql stable set search_path='' as $$
 with active as (
  select id,parent_id,lower(btrim(name, E' \t\n\r\v\f' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) as normalized_name
  from public.bookmark_collections
  where archived_at is null and source_id is distinct from '-1'
 )
 select count(*)=1 and coalesce(bool_and(c.id=p_id),false)
 from active c
 where c.normalized_name='etc'
  and case p_scope
   when 'root' then c.parent_id is null
   when 'community' then exists(select 1 from active parent where parent.id=c.parent_id and parent.parent_id is null and parent.normalized_name='community')
   else false
  end;
$$;
revoke all on function private.bookmark_is_unique_etc_on_route(uuid,text) from public,anon,authenticated,service_role;

do $$
declare definition text;
 lock_marker text := $lock$if p_result->>'communityEtc'='true' or jsonb_path_exists(p_result,'$.items[*].proposal ? (@.communityEtc == true)') then$lock$;
 recommend_marker text := $recommend$p_result->>'communityEtc'='true'
  and not private.bookmark_is_unique_etc((p_result->'recommendation'->>'collectionId')::uuid)$recommend$;
 proposal_marker text := $proposal$v->'proposal'->>'communityEtc'='true'
  and not private.bookmark_is_unique_etc((v->'proposal'->>'collectionId')::uuid)$proposal$;
begin
 definition := replace(pg_get_functiondef('private.bookmark_worker_commit_legacy(uuid,uuid,jsonb)'::regprocedure),chr(13),'');
 recommend_marker := replace(recommend_marker,chr(13),'');
 proposal_marker := replace(proposal_marker,chr(13),'');
 if position(lock_marker in definition)=0 or position(recommend_marker in definition)=0 or position(proposal_marker in definition)=0 then
  raise exception 'bookmark publication guards changed';
 end if;
 definition := replace(definition,lock_marker,$lock$if p_result->>'etcScope' is not null
  or jsonb_path_exists(p_result,'$.items[*].proposal.etcScope ? (@ != null)')
  or p_result->>'communityEtc'='true' or jsonb_path_exists(p_result,'$.items[*].proposal ? (@.communityEtc == true)') then$lock$);
 definition := replace(definition,recommend_marker,$recommend$case
   when p_result->>'etcScope' is not null then not private.bookmark_is_unique_etc_on_route((p_result->'recommendation'->>'collectionId')::uuid,p_result->>'etcScope')
   when p_result->>'communityEtc'='true' then not private.bookmark_is_unique_etc((p_result->'recommendation'->>'collectionId')::uuid)
   else false end$recommend$);
 definition := replace(definition,proposal_marker,$proposal$case
   when v->'proposal'->>'etcScope' is not null then not private.bookmark_is_unique_etc_on_route((v->'proposal'->>'collectionId')::uuid,v->'proposal'->>'etcScope')
   when v->'proposal'->>'communityEtc'='true' then not private.bookmark_is_unique_etc((v->'proposal'->>'collectionId')::uuid)
   else false end$proposal$);
 execute definition;
end $$;

commit;
