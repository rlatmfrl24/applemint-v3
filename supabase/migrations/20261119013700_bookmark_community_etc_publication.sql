begin;

create function private.bookmark_is_unique_etc(p_id uuid) returns boolean
language sql stable set search_path='' as $$
 select count(*)=1 and coalesce(bool_and(id=p_id),false)
 from public.bookmark_collections
 where archived_at is null and source_id is distinct from '-1'
  and lower(btrim(name, E' \t\n\r\v\f' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))='etc';
$$;
revoke all on function private.bookmark_is_unique_etc(uuid) from public,anon,authenticated,service_role;

do $$
declare definition text;
 lock_marker text := 'perform pg_advisory_xact_lock_shared(hashtextextended(''bookmark:collection-lifecycle'',0));';
 recommend_marker text := 'if p_result ? ''recommendation'' then';
 proposal_marker text := 'if v ? ''proposal'' and nullif(v->''proposal''->>''collectionId'','''') is not null';
begin
 definition := pg_get_functiondef('private.bookmark_worker_commit_legacy(uuid,uuid,jsonb)'::regprocedure);
 if position(lock_marker in definition)=0 or position(recommend_marker in definition)=0 or position(proposal_marker in definition)=0 then
  raise exception 'bookmark publication guards changed';
 end if;
 definition := replace(definition,lock_marker,$lock$
 if p_result->>'communityEtc'='true' or jsonb_path_exists(p_result,'$.items[*].proposal ? (@.communityEtc == true)') then
  -- Collection writers take this same lock, including imports and new names on approval.
  perform pg_advisory_xact_lock(hashtextextended('bookmark:collection-lifecycle',0));
 else
  perform pg_advisory_xact_lock_shared(hashtextextended('bookmark:collection-lifecycle',0));
 end if;$lock$);
 definition := replace(definition,recommend_marker,$recommend$
 if p_result ? 'recommendation' and p_result->>'communityEtc'='true'
  and not private.bookmark_is_unique_etc((p_result->'recommendation'->>'collectionId')::uuid) then
  p_result:=(p_result-'recommendation')||jsonb_build_object('state','failed','completed',0,'failed',1,'error','etc 컬렉션이 변경되어 다시 추천받아야 합니다.');
 end if;
 if p_result ? 'recommendation' then$recommend$);
 definition := replace(definition,proposal_marker,$proposal$
 if j.kind='classify' and v->'proposal'->>'communityEtc'='true'
  and not private.bookmark_is_unique_etc((v->'proposal'->>'collectionId')::uuid) then
  v:=(v-'proposal'-'result')||jsonb_build_object('state','failed','error','etc 컬렉션이 변경되어 다시 분류해야 합니다.');
 end if;
 if v ? 'proposal' and nullif(v->'proposal'->>'collectionId','') is not null$proposal$);
 execute definition;
end $$;

commit;
