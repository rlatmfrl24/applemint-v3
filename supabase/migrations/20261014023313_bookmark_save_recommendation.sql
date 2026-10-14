begin;
alter table public.bookmark_jobs drop constraint bookmark_jobs_kind_check;
alter table public.bookmark_jobs add constraint bookmark_jobs_kind_check check(kind in ('metadata','import','check','classify','interests','review','recommend'));

create function private.bookmark_start_recommendation(p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare source public.threads; j public.bookmark_jobs; request_id uuid; draft jsonb;
begin
 if coalesce(p_input->>'threadId','') !~ '^[1-9][0-9]*$' or jsonb_typeof(p_input->'title') is distinct from 'string'
  or length(p_input->>'title')>1000 or nullif(p_input->>'requestId','') is null then
  raise exception 'invalid recommendation input' using errcode='22023';
 end if;
 request_id := (p_input->>'requestId')::uuid;
 select * into source from public.threads where id=(p_input->>'threadId')::bigint for share;
 if not found then raise exception 'thread not found' using errcode='P0002'; end if;
 if source.url !~* '^https?://[^[:space:]]+$' then raise exception 'invalid URL' using errcode='22023'; end if;
 draft := jsonb_build_object('threadId',source.id::text,'url',source.url,'sourceTitle',left(coalesce(source.title,''),1000),
  'officialTitle',(select left(title,1000) from public.thread_media_metadata where thread_id=source.id and provider='youtube'),
  'title',p_input->>'title','provider','jev');
 perform pg_advisory_xact_lock(hashtextextended('bookmark:recommendation:'||request_id,0));
 select * into j from public.bookmark_jobs where id=request_id for update;
 if found then
  if j.kind<>'recommend' or j.scope is distinct from draft then raise exception 'recommendation request changed' using errcode='PT409'; end if;
  return to_jsonb(j);
 end if;
 insert into public.bookmark_jobs(id,kind,scope,total) values(request_id,'recommend',draft,1) returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function private.bookmark_start_recommendation(jsonb) from public,anon,authenticated,service_role;

do $$
declare definition text; marker text;
begin
 definition := pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 marker := 'if p_action=''collectionReorder'' then return private.bookmark_reorder(p_input);';
 if position(marker in definition)=0 then raise exception 'bookmark command dispatch changed'; end if;
 definition := replace(definition,marker,
  'if p_action=''recommend'' then return private.bookmark_start_recommendation(p_input);
 elsif p_action=''collectionReorder'' then return private.bookmark_reorder(p_input);');
 marker := 'if p_action=''save'' then';
 if position(marker in definition)=0 then raise exception 'bookmark save changed'; end if;
 definition := replace(definition,marker,$guard$if p_action='save' then
  if nullif(p_input->>'collectionId','') is not null and p_input ? 'collectionVersion' then
   perform 1 from public.bookmark_collections where id=(p_input->>'collectionId')::uuid
    and archived_at is null and source_id is distinct from '-1' and version=coalesce((p_input->>'collectionVersion')::int,0) for share;
   if not found then raise exception 'collection changed' using errcode='PT409'; end if;
  end if;
  if p_input ? 'recommendationId' then
   select * into j from public.bookmark_jobs where id=(p_input->>'recommendationId')::uuid for share;
   if not found or j.kind<>'recommend' or j.state<>'succeeded'
    or j.scope->>'threadId' is distinct from p_input->>'threadId'
    or j.scope->>'url' is distinct from p_input->>'expectedSourceUrl'
    or j.scope->>'title' is distinct from p_input->>'title'
    or j.progress->'recommendation'->>'collectionId' is distinct from nullif(p_input->>'collectionId','')
    or j.progress->'recommendation'->>'collectionVersion' is distinct from p_input->>'collectionVersion' then
    raise exception 'recommendation changed' using errcode='PT409';
   end if;
  end if;$guard$);
 execute definition;

 definition := pg_get_functiondef('public.bookmark_worker_claim()'::regprocedure);
 marker := 'j.kind in (''classify'',''review'',''interests'')';
 if position(marker in definition)=0 then raise exception 'bookmark crash boundary changed'; end if;
 execute replace(definition,marker,'j.kind in (''classify'',''review'',''interests'',''recommend'')');

 definition := pg_get_functiondef('public.bookmark_worker_commit(uuid,uuid,jsonb)'::regprocedure);
 marker := 'if p_result ? ''reservationId'' then';
 if position(marker in definition)=0 or position('j.kind in (''import'',''interests'')' in definition)=0 then raise exception 'bookmark settlement changed'; end if;
 definition := replace(definition,marker,$commit$if j.kind='recommend' then
  if p_result ? 'recommendation' then
   v := p_result->'recommendation';
   if nullif(v->>'collectionId','') is not null then
    perform 1 from public.bookmark_collections where id=(v->>'collectionId')::uuid and archived_at is null
     and source_id is distinct from '-1' and version=coalesce((v->>'collectionVersion')::int,0) for share;
    if not found then p_result := (p_result-'recommendation')||jsonb_build_object('state','failed','failed',1,'error','추천 컬렉션이 변경되어 다시 추천받아야 합니다.'); end if;
   end if;
   if not exists(select 1 from public.threads t where t.id=(j.scope->>'threadId')::bigint and t.url=j.scope->>'url'
    and left(coalesce(t.title,''),1000)=j.scope->>'sourceTitle'
    and (select left(title,1000) from public.thread_media_metadata where thread_id=t.id and provider='youtube') is not distinct from j.scope->>'officialTitle') then
    p_result := (p_result-'recommendation')||jsonb_build_object('state','failed','failed',1,'error','원본 글이 변경되어 다시 추천받아야 합니다.');
   end if;
  end if;
  p_result := p_result||jsonb_build_object('progress',coalesce(p_result->'progress','{}')||jsonb_build_object('recommendation',p_result->'recommendation'));
 end if;
 if p_result ? 'reservationId' then$commit$);
 definition := replace(definition,'j.kind in (''import'',''interests'')','j.kind in (''import'',''interests'',''recommend'')');
 execute definition;
end $$;
commit;
