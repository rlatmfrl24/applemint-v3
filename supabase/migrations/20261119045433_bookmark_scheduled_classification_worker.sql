begin;

create index bookmark_ai_reservations_open_job_idx on public.bookmark_ai_reservations(job_id)
 where state in ('reserved','uncertain');

alter function public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text) set schema private;
revoke all on function private.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text) from public,anon,authenticated,service_role;

create function public.bookmark_ai_reserve(p_id uuid,p_job uuid,p_lease uuid,p_tokens int,p_amount bigint,p_provider text,p_model text)
returns boolean language sql security definer set search_path='' as $$
 select case when exists(
  select 1 from public.bookmark_jobs where id=p_job and kind='classify' and scope->>'origin'='scheduled-classify'
 ) then false else private.bookmark_ai_reserve(p_id,p_job,p_lease,p_tokens,p_amount,p_provider,p_model) end
$$;

create function public.bookmark_scheduled_classification_reserve(p_id uuid,p_job uuid,p_lease uuid,p_tokens int,p_amount bigint,p_provider text,p_model text)
returns text language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('bookmark:scheduled-classification',0));
 perform 1 from public.bookmark_jobs where id=p_job and kind='classify' and scope->>'origin'='scheduled-classify'
  and state='processing' and lease_token=p_lease and lease_expires_at>clock_timestamp() and not (progress ? 'closedAt')
 for update;
 if not found then return 'denied'; end if;
 if not (select classify_auto_enabled from public.bookmark_settings where id) then return 'disabled'; end if;
 if private.bookmark_ai_reserve(p_id,p_job,p_lease,p_tokens,p_amount,p_provider,p_model) then return 'reserved'; end if;
 return 'denied';
end $$;

create function private.bookmark_scheduled_classification_claimable(j public.bookmark_jobs)
returns boolean language sql stable set search_path='' as $$
 -- Expired paid leases still need receipt recovery when scheduling is off.
 select not (j.progress ? 'closedAt') and (
  (select classify_auto_enabled from public.bookmark_settings where id)
  or (j.state='processing' and exists (
   select 1 from public.bookmark_ai_reservations where job_id=j.id and state='reserved'
  ))
 )
$$;

revoke all on function private.bookmark_scheduled_classification_claimable(public.bookmark_jobs),
 public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text),
 public.bookmark_scheduled_classification_reserve(uuid,uuid,uuid,int,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text),
 public.bookmark_scheduled_classification_reserve(uuid,uuid,uuid,int,bigint,text,text) to service_role;

do $$
declare
 definition text;
 marker text;
begin
 definition:=pg_get_functiondef('public.bookmark_worker_claim()'::regprocedure);
 marker:=$order$order by case when kind='recommend' then 0 when scope->>'origin'='automatic' then 2 else 1 end$order$;
 if strpos(definition,marker)=0 then raise exception 'bookmark claim priority boundary changed'; end if;
 definition:=replace(definition,marker,$claim$
  and (kind<>'classify' or scope->>'origin' is distinct from 'scheduled-classify'
   or private.bookmark_scheduled_classification_claimable(bookmark_jobs))
  order by case when kind='recommend' then 0 when kind='classify' and scope->>'origin'='scheduled-classify' then 3
   when scope->>'origin'='automatic' then 2 else 1 end$claim$);
 marker:=$batch$order by bookmark_id limit case when j.kind in ('classify','review') then 20 else 1 end$batch$;
 if strpos(definition,marker)=0 then raise exception 'bookmark claim batch boundary changed'; end if;
 definition:=replace(definition,marker,$batch$
  order by case when j.kind='classify' and j.scope->>'origin'='scheduled-classify' then
   (select b.saved_at from public.bookmarks b where b.id=bookmark_job_items.bookmark_id)
  end,bookmark_id limit case when j.kind in ('classify','review') then 20 else 1 end$batch$);
 marker:=$items$d.state='library'))),'[]') into v_items$items$;
 if strpos(definition,marker)=0 then raise exception 'bookmark claim response boundary changed'; end if;
 definition:=replace(definition,marker,$items$d.state='library'))
  order by case when j.kind='classify' and j.scope->>'origin'='scheduled-classify' then b.saved_at end,i.bookmark_id),'[]') into v_items$items$);
 marker:=$receipt$error='이전 AI 요청의 응답이 확인되지 않아 예약액을 유지합니다. 직접 재개해주세요.'$receipt$;
 if strpos(definition,marker)=0 then raise exception 'bookmark expired receipt boundary changed'; end if;
 execute replace(definition,marker,marker||$uncertain$,
   progress=case when scope->>'origin'='scheduled-classify' then progress||'{"usageUncertain":true}'::jsonb else progress end$uncertain$);

 definition:=pg_get_functiondef('private.bookmark_worker_commit_legacy(uuid,uuid,jsonb)'::regprocedure);
 marker:='declare j public.bookmark_jobs;';
 if strpos(definition,marker)=0 then raise exception 'bookmark commit declaration changed'; end if;
 definition:=replace(definition,marker,marker||' v_bookmark public.bookmarks;');
 marker:=$lock$if j.kind='review' then perform 1 from public.bookmarks where id=v_id for update; end if;$lock$;
 if strpos(definition,marker)=0 then raise exception 'bookmark publication row lock boundary changed'; end if;
 definition:=replace(definition,marker,$guard$
  if j.kind in ('classify','review') then select * into v_bookmark from public.bookmarks where id=v_id for update; end if;
  if j.kind='classify' and j.scope->>'origin'='scheduled-classify' then
   if v_bookmark.state is distinct from 'library'
    or v_bookmark.version is distinct from (v->>'version')::int
    or v_bookmark.version is distinct from (select expected_version from public.bookmark_job_items where job_id=j.id and bookmark_id=v_id) then
    v:=(v-'proposal')||jsonb_build_object('state','failed','error','북마크가 변경되어 다시 분류해야 합니다.');
   elsif v ? 'proposal' then
    if nullif(v->'proposal'->>'collectionId','') is null
      or v_bookmark.collection_id=(v->'proposal'->>'collectionId')::uuid then
     v:=v-'proposal';
    elsif exists(select 1 from public.bookmark_proposals p where p.bookmark_id=v_id and p.kind='classify'
      and p.state='pending' and p.expected_version=v_bookmark.version) then
     v:=(v-'proposal')||jsonb_build_object('result',coalesce(v->'result','{}')||
      jsonb_build_object('reason','현재 버전의 컬렉션 제안이 이미 검토 대기 중입니다.'));
    end if;
   end if;
  end if;
 $guard$);
 marker:=$progress$progress=progress||coalesce(p_result->'progress','{}'),$progress$;
 if strpos(definition,marker)=0 then raise exception 'bookmark job progress boundary changed'; end if;
 definition:=replace(definition,marker,$progress$progress=progress||coalesce(p_result->'progress','{}')||
  case when j.kind='classify' and j.scope->>'origin'='scheduled-classify' then jsonb_build_object('usageUncertain',exists(
   select 1 from public.bookmark_ai_reservations r where r.job_id=j.id and r.state='uncertain'
  )) else '{}'::jsonb end,$progress$);
 marker:=$error$error=p_result->>'error',$error$;
 if strpos(definition,marker)=0 then raise exception 'bookmark job error boundary changed'; end if;
 execute replace(definition,marker,$error$error=coalesce(p_result->>'error',
  case when j.kind='classify' and j.scope->>'origin'='scheduled-classify' and v_state='partial' then
   (select i.error from public.bookmark_job_items i where i.job_id=j.id and i.state='failed' and i.error is not null order by i.bookmark_id limit 1)
  end),$error$);
end $$;

commit;
