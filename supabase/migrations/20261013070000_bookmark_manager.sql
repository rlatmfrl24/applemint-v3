begin;
alter table public.bookmark_collections add column archived_at timestamptz;
alter table public.bookmarks add column previous_collection_path text;

create function public.bookmark_collection_path(p_id uuid) returns text language sql stable security definer set search_path='' as $$
 with recursive ancestry as (
  select c.id,c.parent_id,c.name,array[c.id] visited,0 depth from public.bookmark_collections c where c.id=p_id
  union all select c.id,c.parent_id,c.name,a.visited||c.id,a.depth+1 from ancestry a join public.bookmark_collections c on c.id=a.parent_id where not c.id=any(a.visited)
 ) select coalesce(string_agg(name,' / ' order by depth desc),'미분류') from ancestry;
$$;
create function public.bookmark_assert_collection(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_id is not null and not exists(select 1 from public.bookmark_collections where id=p_id and archived_at is null and source_id is distinct from '-1') then raise exception 'collection changed' using errcode='40001'; end if;
end $$;
create function public.bookmark_review_matches(b public.bookmarks,p_type text) returns boolean language sql stable security definer set search_path='' as $$
 select case p_type
 when 'all' then public.bookmark_review_due(b)
 when 'dead' then exists(select 1 from public.bookmark_checks c where c.bookmark_id=b.id and c.status='dead' and c.reviewed_at is null and c.bookmark_version=b.version and c.checked_at=(select max(checked_at) from public.bookmark_checks where bookmark_id=b.id))
 when 'classify' then exists(select 1 from public.bookmark_proposals p where p.bookmark_id=b.id and p.kind='classify' and p.state='pending')
 when 'unused' then exists(select 1 from public.bookmark_proposals p where p.bookmark_id=b.id and p.kind='review' and p.state='pending') or ((b.saved_at<now()-interval '180 days' or exists(select 1 from public.bookmarks d where d.url_key=b.url_key and d.id<>b.id and d.state='library')) and not exists(select 1 from public.bookmark_events e where e.bookmark_id=b.id and e.kind='keep' and e.created_at>=b.updated_at))
 else false end;
$$;
create function public.bookmark_review_priority(b public.bookmarks) returns integer language sql stable security definer set search_path='' as $$
 select case when public.bookmark_review_matches(b,'dead') then 0 when public.bookmark_review_matches(b,'classify') then 1 else 2 end;
$$;
revoke all on function public.bookmark_collection_path(uuid),public.bookmark_assert_collection(uuid),public.bookmark_review_matches(public.bookmarks,text),public.bookmark_review_priority(public.bookmarks) from public,anon,authenticated,service_role;


create or replace function public.bookmark_snapshot(p_filter jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_month date := date_trunc('month',now() at time zone 'Asia/Seoul')::date;
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if coalesce(p_filter->>'reviewType','all') not in ('all','dead','unused','classify') then raise exception 'invalid review type' using errcode='22023'; end if;
 select jsonb_build_object(
  'items',coalesce(jsonb_agg(row_data order by case when coalesce((p_filter->>'review')::boolean,false) then review_priority end,case when coalesce((p_filter->>'review')::boolean,false) then (row_data->>'saved_at')::timestamptz end asc,(row_data->>'saved_at')::timestamptz desc,row_data->>'id'),'[]'),
  'total',(select count(*) from public.bookmarks b where b.state=coalesce(p_filter->>'state','library')
    and (not coalesce((p_filter->>'review')::boolean,false) or public.bookmark_review_matches(b,coalesce(p_filter->>'reviewType','all')))
    and (not p_filter ? 'collectionId' or b.collection_id is not distinct from nullif(p_filter->>'collectionId','')::uuid)
    and (coalesce(p_filter->>'search','')='' or b.title ilike '%'||(p_filter->>'search')||'%' or b.url ilike '%'||(p_filter->>'search')||'%')),
  'collections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.id),'[]') from public.bookmark_collections c where c.source_id is distinct from '-1' and c.archived_at is null),
  'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]') from public.bookmark_jobs j where j.kind='import' or j.id in (select id from public.bookmark_jobs order by created_at desc limit 30)),
  'settings',(select to_jsonb(s) from public.bookmark_settings s where s.id),
  'budget',jsonb_build_object('month',v_month,'limit_nano',1000000000,'used_nano',
    (select coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else reserved_nano end),0) from public.bookmark_ai_reservations where month=v_month))
 ) into v_result
 from (
  select public.bookmark_row(b) || jsonb_build_object(
   'duplicate_count',(select count(*) from public.bookmarks d where d.url_key=b.url_key and d.id<>b.id and d.state='library'),
   'check',(select to_jsonb(c) from public.bookmark_checks c where c.bookmark_id=b.id order by c.checked_at desc limit 1),
   'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') from public.bookmark_proposals p where p.bookmark_id=b.id and p.state='pending'),
   'last_review',(select to_jsonb(e) from public.bookmark_events e where e.bookmark_id=b.id and e.kind='keep' order by e.created_at desc limit 1)
  ) row_data,public.bookmark_review_priority(b) review_priority
  from public.bookmarks b
  where (p_filter ? 'id' or b.state=coalesce(p_filter->>'state','library'))
   and (not coalesce((p_filter->>'review')::boolean,false) or public.bookmark_review_matches(b,coalesce(p_filter->>'reviewType','all')))
   and (not p_filter ? 'collectionId' or b.collection_id is not distinct from nullif(p_filter->>'collectionId','')::uuid)
   and (not p_filter ? 'id' or b.id=(p_filter->>'id')::uuid)
   and (coalesce(p_filter->>'search','')='' or b.title ilike '%'||(p_filter->>'search')||'%' or b.url ilike '%'||(p_filter->>'search')||'%')
  order by case when coalesce((p_filter->>'review')::boolean,false) then public.bookmark_review_priority(b) end,case when coalesce((p_filter->>'review')::boolean,false) then b.saved_at end asc,b.saved_at desc,b.id
  limit least(greatest(coalesce((p_filter->>'limit')::int,50),1),100)
  offset greatest(coalesce((p_filter->>'offset')::int,0),0)
 ) rows;
 return v_result;
end $$;

create or replace function public.bookmark_command(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 b public.bookmarks; j public.bookmark_jobs; c public.bookmark_collections; p public.bookmark_proposals;
 v_job uuid; v_target uuid; v_proposal jsonb; v_url text; v_kind text; v_count integer; v_original jsonb; v_children integer; v_path text;
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if p_action='collectionRemove' then
  perform pg_advisory_xact_lock(hashtextextended('bookmark:collection-lifecycle',0));
 else
 perform pg_advisory_xact_lock_shared(hashtextextended('bookmark:collection-lifecycle',0));
 end if;
 if p_action='save' then
  perform public.bookmark_assert_collection(nullif(p_input->>'collectionId','')::uuid);
  v_url:=btrim(p_input->>'url');
  if p_input ? 'threadId' then
   select to_jsonb(t)||jsonb_build_object('id',t.id::text) into v_original from public.threads t where id=(p_input->>'threadId')::bigint for share;
   if not found then raise exception 'thread not found' using errcode='P0002'; end if;
   if v_original->>'url' is distinct from p_input->>'expectedSourceUrl' then raise exception 'source changed' using errcode='40001'; end if;
  end if;
  if v_url is null or v_url !~* '^https?://[^[:space:]]+$' then raise exception 'invalid URL' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bookmark:url:'||v_url,0));
  select * into b from public.bookmarks where url_key=v_url order by (state='library') desc,updated_at desc,id limit 1;
  if found then return jsonb_build_object('item',public.bookmark_row(b),'existing',true); end if;
  insert into public.bookmarks(url,url_key,title,tags,note,collection_id,source_thread_id,original)
   values(v_url,v_url,coalesce(p_input->>'title',''),coalesce(array(select jsonb_array_elements_text(p_input->'tags')),'{}'),coalesce(p_input->>'note',''),nullif(p_input->>'collectionId','')::uuid,nullif(p_input->>'threadId','')::bigint,v_original)
   returning * into b;
  insert into public.bookmark_jobs(kind,total) values('metadata',1) returning id into v_job;
  insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) values(v_job,b.id,b.version);
  return jsonb_build_object('item',public.bookmark_row(b),'existing',false);
 elsif p_action='bulk' then
  if p_input->>'action' not in ('trash','restore','keep') then raise exception 'invalid bulk action' using errcode='22023'; end if;
  for v_proposal in select value from jsonb_array_elements(p_input->'items') order by value->>'id' loop
   perform public.bookmark_command(p_input->>'action',v_proposal);
  end loop;
  return jsonb_build_object('applied',jsonb_array_length(p_input->'items'));
 elsif p_action in ('edit','trash','restore','open','keep','move') then
  select * into b from public.bookmarks where id=(p_input->>'id')::uuid for update;
  if not found then raise exception 'bookmark not found' using errcode='P0002'; end if;
  if p_action in ('edit','move') and p_input ? 'collectionId' then perform public.bookmark_assert_collection(nullif(p_input->>'collectionId','')::uuid); end if;
  if p_action<>'open' and b.version<>coalesce((p_input->>'version')::int,0) then raise exception 'bookmark changed' using errcode='40001'; end if;
  if p_action='open' then
   update public.bookmarks set opened_at=now(),open_count=open_count+1,review_revision=review_revision+1 where id=b.id returning * into b;
  elsif p_action='keep' then
   update public.bookmarks set review_revision=review_revision+1 where id=b.id returning * into b;
   update public.bookmark_checks set reviewed_at=now() where bookmark_id=b.id and reviewed_at is null;
   update public.bookmark_proposals set state='excluded' where bookmark_id=b.id and kind='review' and state='pending';
  else
   update public.bookmarks set
    state=case p_action when 'trash' then 'trash' when 'restore' then 'library' else state end,
    title=case when p_action='edit' then coalesce(p_input->>'title',title) else title end,
    description=case when p_action='edit' then coalesce(p_input->>'description',description) else description end,
    note=case when p_action='edit' then coalesce(p_input->>'note',note) else note end,
    tags=case when p_action='edit' and p_input ? 'tags' then array(select jsonb_array_elements_text(p_input->'tags')) else tags end,
    previous_collection_path=case when p_action in ('edit','move') and p_input ? 'collectionId' and b.collection_id is distinct from nullif(p_input->>'collectionId','')::uuid and b.collection_id is not null then public.bookmark_collection_path(b.collection_id) else previous_collection_path end,
    collection_id=case when p_action in ('edit','move') and p_input ? 'collectionId' then nullif(p_input->>'collectionId','')::uuid else collection_id end,
    version=version+1,updated_at=now() where id=b.id returning * into b;
   if p_action='trash' then
    update public.bookmark_checks set reviewed_at=now() where bookmark_id=b.id and reviewed_at is null;
    update public.bookmark_proposals set state='excluded' where bookmark_id=b.id and state='pending';
   end if;
  end if;
  insert into public.bookmark_events(bookmark_id,kind,evidence_id) values(b.id,case p_action when 'edit' then 'edit' else p_action end,nullif(p_input->>'evidenceId','')::uuid);
  return public.bookmark_row(b);
 elsif p_action='collectionRemove' then
  select * into c from public.bookmark_collections where id=(p_input->>'id')::uuid and archived_at is null for update;
  if not found or c.version<>coalesce((p_input->>'version')::int,0) then raise exception 'collection changed' using errcode='40001'; end if;
  v_path:=public.bookmark_collection_path(c.id);
  perform 1 from public.bookmarks where collection_id=c.id order by id for update;
  update public.bookmark_proposals set state='excluded' where state='pending' and (target_collection_id=c.id or bookmark_id in (select id from public.bookmarks where collection_id=c.id));
  insert into public.bookmark_events(bookmark_id,kind) select id,'move' from public.bookmarks where collection_id=c.id;
  update public.bookmarks set collection_id=null,previous_collection_path=v_path,version=version+1,updated_at=now() where collection_id=c.id;
  get diagnostics v_count=row_count;
  update public.bookmark_collections set parent_id=c.parent_id,version=version+1 where parent_id=c.id and archived_at is null;
  get diagnostics v_children=row_count;
  update public.bookmark_collections set archived_at=now(),version=version+1 where id=c.id;
  return jsonb_build_object('deletedId',c.id,'movedBookmarks',v_count,'reparentedCollections',v_children);
 elsif p_action in ('collectionCreate','collectionRename') then
  if p_action='collectionCreate' then
   perform public.bookmark_assert_collection(nullif(p_input->>'parentId','')::uuid);
   insert into public.bookmark_collections(name,parent_id) values(btrim(p_input->>'name'),nullif(p_input->>'parentId','')::uuid) returning * into c;
  else
   update public.bookmark_collections set name=btrim(p_input->>'name'),version=version+1 where id=(p_input->>'id')::uuid and version=(p_input->>'version')::int and archived_at is null returning * into c;
   if not found then raise exception 'collection changed' using errcode='40001'; end if;
  end if;
  return to_jsonb(c);
 elsif p_action='interests' then
  update public.bookmark_settings set interests=array(select jsonb_array_elements_text(p_input->'interests')),interests_confirmed_at=now(),interest_version=interest_version+1 where id;
  -- A topic change invalidates old relevance suggestions without inventing new ones.
  update public.bookmark_proposals set state='excluded' where kind='review' and state='pending';
  return (select to_jsonb(s) from public.bookmark_settings s where id);
 elsif p_action='start' then
  if p_input->>'scope'='collection' then perform public.bookmark_assert_collection(nullif(p_input->>'collectionId','')::uuid); end if;
  v_kind:=p_input->>'kind';
  if v_kind not in ('import','check','classify','interests','review') then raise exception 'invalid kind' using errcode='22023'; end if;
  if v_kind='import' then
   if coalesce((p_input->>'confirmed')::boolean,false)=false then raise exception 'import confirmation required' using errcode='22023'; end if;
   perform pg_advisory_xact_lock(hashtextextended('bookmark:import',0));
   select * into j from public.bookmark_jobs where kind='import' for update;
   if found then
    if j.state='succeeded' then raise exception 'import already completed' using errcode='40001'; end if;
    if j.state in ('failed','partial','paused') then return public.bookmark_command('resume',jsonb_build_object('id',j.id)); end if;
    return to_jsonb(j);
   end if;
  end if;
  insert into public.bookmark_jobs(kind,scope,total,progress) values(v_kind,p_input,case when v_kind='interests' then 1 else 0 end,
   jsonb_build_object('interestVersion',(select interest_version from public.bookmark_settings where id))) returning * into j;
  if v_kind in ('check','classify','review') then
   insert into public.bookmark_job_items(job_id,bookmark_id,expected_version)
    select j.id,id,version from public.bookmarks where state='library'
     and (coalesce(p_input->>'scope','all')<>'collection' or collection_id is not distinct from nullif(p_input->>'collectionId','')::uuid)
     and (coalesce(p_input->>'scope','all')<>'selected' or id in (select value::uuid from jsonb_array_elements_text(p_input->'ids')));
   get diagnostics v_count=row_count;
   update public.bookmark_jobs set total=v_count,state=case when v_count=0 then 'succeeded' else 'queued' end where id=j.id returning * into j;
  end if;
  return to_jsonb(j);
 elsif p_action='resume' then
  select * into j from public.bookmark_jobs where id=(p_input->>'id')::uuid for update;
  if not found then raise exception 'job not found' using errcode='P0002'; end if;
  if j.state not in ('failed','partial','paused') then raise exception 'job cannot resume' using errcode='40001'; end if;
  update public.bookmark_job_items i set state='pending',error=null,expected_version=book.version from public.bookmarks book where i.job_id=j.id and i.bookmark_id=book.id and i.state='failed';
  if j.kind='import' then delete from public.bookmark_import_verifications where job_id=j.id; end if;
  update public.bookmark_jobs set state='queued',available_at=now(),error=null,
   progress=case when kind='import' then jsonb_strip_nulls(jsonb_build_object('page',0,'phase','manifest','errorAttempts',0,'accountId',progress->'accountId')) else progress||jsonb_build_object('errorAttempts',0) end,updated_at=now() where id=j.id returning * into j;
  return to_jsonb(j);
 elsif p_action='proposalApply' then
  -- All selected edits, collection creation and moves commit together or none commit.
  if exists(select 1 from public.bookmark_proposals where kind='review' and id in (select (value->>'id')::uuid from jsonb_array_elements(p_input->'items'))) then perform 1 from public.bookmark_settings where id for share; end if;
  for v_proposal in select selected.value from jsonb_array_elements(p_input->'items') selected left join public.bookmark_proposals proposal on proposal.id=(selected.value->>'id')::uuid order by proposal.bookmark_id,proposal.id loop
   select * into p from public.bookmark_proposals where id=(v_proposal->>'id')::uuid;
   if not found then raise exception 'proposal changed' using errcode='40001'; end if;
   select * into b from public.bookmarks where id=p.bookmark_id for update;
   select * into p from public.bookmark_proposals where id=(v_proposal->>'id')::uuid for update;
   if not found or p.state<>'pending' then raise exception 'proposal changed' using errcode='40001'; end if;
   if not coalesce((v_proposal->>'exclude')::boolean,false) and (b.version<>p.expected_version or b.state<>'library' or (p.kind='review' and (b.review_revision<>p.expected_review_revision or p.expected_interest_version<>(select interest_version from public.bookmark_settings where id)))) then raise exception 'bookmark changed' using errcode='40001'; end if;
   if coalesce((v_proposal->>'exclude')::boolean,false) then
    update public.bookmark_proposals set state='excluded' where id=p.id;
   elsif p.kind='review' then
    update public.bookmark_proposals set state='approved' where id=p.id;
    update public.bookmarks set state='trash',version=version+1,updated_at=now() where id=b.id;
    insert into public.bookmark_events(bookmark_id,kind,evidence_id) values(b.id,'trash',p.id);
   else
    v_target:=case when v_proposal ? 'collectionId' then nullif(v_proposal->>'collectionId','')::uuid else p.target_collection_id end;
    if nullif(btrim(coalesce(v_proposal->>'newCollectionName',p.new_collection_name)),'') is not null then
     perform pg_advisory_xact_lock(hashtextextended('bookmark:new-collection:'||p.job_id||':'||btrim(coalesce(v_proposal->>'newCollectionName',p.new_collection_name)),0));
     select target_collection_id into v_target from public.bookmark_proposals where job_id=p.job_id and state='approved' and new_collection_name=btrim(coalesce(v_proposal->>'newCollectionName',p.new_collection_name)) and target_collection_id in (select id from public.bookmark_collections where archived_at is null) order by created_at,id limit 1;
     if v_target is null then insert into public.bookmark_collections(name) values(btrim(coalesce(v_proposal->>'newCollectionName',p.new_collection_name))) returning id into v_target; end if;
    end if;
    perform public.bookmark_assert_collection(v_target);
    update public.bookmarks set previous_collection_path=case when b.collection_id is not null and b.collection_id is distinct from v_target then public.bookmark_collection_path(b.collection_id) else previous_collection_path end,collection_id=v_target,version=version+1,updated_at=now() where id=b.id;
    update public.bookmark_proposals set state='approved',target_collection_id=v_target,new_collection_name=nullif(btrim(coalesce(v_proposal->>'newCollectionName',p.new_collection_name)),'') where id=p.id;
    insert into public.bookmark_events(bookmark_id,kind,evidence_id) values(b.id,'move',p.id);
   end if;
  end loop;
  return jsonb_build_object('applied',jsonb_array_length(p_input->'items'));
 end if;
 raise exception 'invalid action' using errcode='22023';
end $$;

create or replace function public.bookmark_worker_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.bookmark_jobs; v_items jsonb;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('bookmark:collection-lifecycle',0));
 select * into j from public.bookmark_jobs where
  ((state in ('queued','retry') and available_at<=now()) or (state='processing' and lease_expires_at<=now()))
  order by available_at,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 if j.state='processing' and j.kind in ('classify','review','interests') and exists(select 1 from public.bookmark_ai_reservations where job_id=j.id and state='reserved') then
  update public.bookmark_ai_reservations set state='uncertain' where job_id=j.id and state='reserved';
  update public.bookmark_jobs set state='paused',lease_token=null,lease_expires_at=null,error='이전 AI 요청의 응답이 확인되지 않아 예약액을 유지합니다. 직접 재개해주세요.',updated_at=now() where id=j.id;
  return null;
 end if;
 update public.bookmark_jobs set state='processing',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
  where id=j.id returning * into j;
 select coalesce(jsonb_agg(public.bookmark_row(b)||jsonb_build_object('expected_version',i.expected_version,'previous',i.result,
  'duplicate_count',(select count(*) from public.bookmarks d where d.url_key=b.url_key and d.id<>b.id and d.state='library'))),'[]') into v_items
  from (select * from public.bookmark_job_items where job_id=j.id and state in ('pending','waiting') and available_at<=now() order by bookmark_id limit case when j.kind in ('classify','review') then 20 else 1 end) i
  join public.bookmarks b on b.id=i.bookmark_id;
 return jsonb_build_object('job',to_jsonb(j),'items',v_items,
  'collections',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.bookmark_collections c where c.source_id is distinct from '-1' and c.archived_at is null),
  'settings',(select to_jsonb(s) from public.bookmark_settings s where id));
end $$;

create or replace function public.bookmark_worker_commit(p_job uuid,p_lease uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.bookmark_jobs; v jsonb; v_id uuid; v_target uuid; v_stored int; v_state text; v_pending int; v_fail int; v_done int; v_previous_path text;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('bookmark:collection-lifecycle',0));
 select * into j from public.bookmark_jobs where id=p_job and state='processing' and lease_token=p_lease and lease_expires_at>now() for update;
 if not found then return false; end if;
 if p_result ? 'reservationId' then
  update public.bookmark_ai_reservations set
   state=coalesce(p_result->>'reservationState','uncertain'),
   charged_nano=case when p_result ? 'chargedNano' then (p_result->>'chargedNano')::bigint else null end,
   output_tokens=nullif(p_result->>'outputTokens','')::int
   where id=(p_result->>'reservationId')::uuid and job_id=j.id and state='reserved';
 end if;
 if p_result ? 'importCollections' then
  for v in select value from jsonb_array_elements(p_result->'importCollections') loop
   if v->>'sourceId'='-99' then raise exception 'trash collection excluded' using errcode='22023'; end if;
   insert into public.bookmark_collections(name,source_id,original) values(v->>'name',v->>'sourceId',v->'original') on conflict(source_id) do nothing;
  end loop;
  update public.bookmark_collections c set parent_id=parent.id from public.bookmark_collections parent
   where c.original->>'parentSourceId'=parent.source_id and c.version=1 and c.parent_id is null and c.id<>parent.id and c.archived_at is null and parent.archived_at is null;
 end if;
 if p_result ? 'importItems' then
  for v in select value from jsonb_array_elements(p_result->'importItems') loop
   if v->>'collectionSourceId'='-99' then raise exception 'trash bookmark excluded' using errcode='22023'; end if;
   -- Raindrop Unsorted uses Applemint's null membership; its original source record remains intact.
   select id into v_target from public.bookmark_collections where source_id=v->>'collectionSourceId' and source_id<>'-1' and archived_at is null;
   select case when archived_at is not null then public.bookmark_collection_path(id) end into v_previous_path from public.bookmark_collections where source_id=v->>'collectionSourceId' and source_id<>'-1';
   insert into public.bookmarks(url,url_key,title,description,tags,note,collection_id,source_id,original,saved_at,previous_collection_path)
    values(v->>'url',v->>'urlKey',coalesce(v->>'title',''),coalesce(v->>'description',''),
     array(select jsonb_array_elements_text(v->'tags')),coalesce(v->>'note',''),v_target,v->>'sourceId',v->'original',(v->>'savedAt')::timestamptz,v_previous_path)
    on conflict(source_id) do nothing;
  end loop;
  select count(*) into v_stored from public.bookmarks where source_id is not null;
  p_result:=p_result||jsonb_build_object('completed',v_stored,'progress',coalesce(p_result->'progress','{}')||jsonb_build_object('storedCount',v_stored));
 end if;
 if coalesce((p_result->>'resetVerification')::boolean,false) then delete from public.bookmark_import_verifications where job_id=j.id; end if;
 if p_result ? 'verifyItems' then
  insert into public.bookmark_import_verifications(job_id,source_id,collection_source_id)
   select j.id,value->>'sourceId',value->>'collectionSourceId' from jsonb_array_elements(p_result->'verifyItems') on conflict(job_id,source_id) do nothing;
 end if;
 if p_result ? 'interests' then
  update public.bookmark_settings set suggested_interests=array(select jsonb_array_elements_text(p_result->'interests')),suggestions_job_id=j.id,suggested_at=now() where id;
 end if;
 if j.kind='review' then perform 1 from public.bookmark_settings where id for share; end if;
 for v in select value from jsonb_array_elements(coalesce(p_result->'items','[]')) order by value->>'id' loop
  v_id:=(v->>'id')::uuid;
  if not exists(select 1 from public.bookmark_job_items where job_id=j.id and bookmark_id=v_id and state in ('pending','waiting')) then raise exception 'unexpected job item' using errcode='22023'; end if;
  if j.kind='review' then perform 1 from public.bookmarks where id=v_id for update; end if;
  if j.kind='review' and (coalesce((v->>'reviewRevision')::int,-1)<>(select review_revision from public.bookmarks where id=v_id)
   or (p_result->>'interestVersion')::int is distinct from (select interest_version from public.bookmark_settings where id)) then
   v:=(v-'proposal')||jsonb_build_object('state','failed','error','열기·유지 기록 또는 관심 주제가 변경되어 재검토가 필요합니다.');
  end if;
  if v ? 'metadata' then
   update public.bookmarks set title=case when title='' then left(coalesce(v->'metadata'->>'title',''),1000) else title end,
    description=case when description='' then left(coalesce(v->'metadata'->>'description',''),4000) else description end,
    version=version+1,updated_at=now()
    where id=v_id and version=(v->>'version')::int
     and ((title='' and coalesce(v->'metadata'->>'title','')<>'') or (description='' and coalesce(v->'metadata'->>'description','')<>''));
  end if;
  if v ? 'check' then
   insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,reason,final_url,http_status)
    values(v_id,j.id,(v->>'version')::int,v->'check'->>'status',v->'check'->>'reason',v->'check'->>'finalUrl',nullif(v->'check'->>'httpStatus','')::int)
    on conflict(job_id,bookmark_id) do nothing;
  end if;
  if v ? 'proposal' and nullif(v->'proposal'->>'collectionId','') is not null and not exists(select 1 from public.bookmark_collections where id=(v->'proposal'->>'collectionId')::uuid and archived_at is null and source_id is distinct from '-1') then
   v:=(v-'proposal')||jsonb_build_object('state','failed','error','컬렉션이 삭제되어 다시 분류해야 합니다.');
  end if;
  if v ? 'proposal' then
   -- Never attach outdated interest evidence to current review decisions.
   if j.kind<>'review' or (p_result->>'interestVersion')::int=(select interest_version from public.bookmark_settings where id) then
    insert into public.bookmark_proposals(job_id,bookmark_id,expected_version,kind,expected_review_revision,expected_interest_version,target_collection_id,new_collection_name,reason,relevance)
     values(j.id,v_id,(v->>'version')::int,j.kind,coalesce((v->>'reviewRevision')::int,0),coalesce((p_result->>'interestVersion')::int,1),nullif(v->'proposal'->>'collectionId','')::uuid,nullif(v->'proposal'->>'newCollectionName',''),v->'proposal'->>'reason',v->'proposal'->>'relevance')
     on conflict(job_id,bookmark_id) do nothing;
   else
    v:=v||jsonb_build_object('state','failed','error','관심 주제가 변경되어 재검토가 필요합니다.');
   end if;
  end if;
  update public.bookmark_job_items set state=coalesce(v->>'state','done'),result=coalesce(v->'result',result),error=v->>'error',
   available_at=case when v->>'state'='waiting' then now()+interval '1 minute' else now() end
   where job_id=j.id and bookmark_id=v_id;
 end loop;
 if j.kind in ('import','interests') then
  v_state:=coalesce(p_result->>'state','retry');
  v_done:=coalesce((p_result->>'completed')::int,j.completed);
  v_fail:=coalesce((p_result->>'failed')::int,j.failed);
 else
  select count(*) filter(where state in ('pending','waiting')),count(*) filter(where state='failed'),count(*) filter(where state='done')
   into v_pending,v_fail,v_done from public.bookmark_job_items where job_id=j.id;
  v_state:=case when v_pending=0 then case when v_fail>0 then 'partial' else 'succeeded' end else 'retry' end;
  if p_result->>'state' in ('paused','failed') then v_state:=p_result->>'state'; end if;
 end if;
 update public.bookmark_jobs set state=v_state,completed=v_done,failed=v_fail,
  total=coalesce((p_result->>'total')::int,total),
  progress=progress||coalesce(p_result->'progress','{}'),error=p_result->>'error',
  available_at=case when p_result ? 'retryAfterSeconds' then now()+make_interval(secs=>(p_result->>'retryAfterSeconds')::int) when j.kind='import' then now()+interval '1100 milliseconds' else coalesce((select min(available_at) from public.bookmark_job_items where job_id=j.id and state in ('pending','waiting')),now()) end,
  lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 return true;
end $$;

commit;
