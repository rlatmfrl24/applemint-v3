begin;
alter table public.bookmark_checks
 add column checked_url text,
 add column evidence jsonb check(evidence is null or octet_length(evidence::text)<=8192),
 add column evidence_revision integer not null default 1 check(evidence_revision>0);
alter table public.bookmark_job_items add column work jsonb check(work is null or octet_length(work::text)<=65536);
alter table public.bookmark_settings
 add column health_auto_enabled boolean not null default false,
 add column health_daily_limit integer not null default 500 check(health_daily_limit between 1 and 1000);
alter table public.bookmark_ai_reservations
 add column health_evidence_key text unique,
 add column health_bookmark_id uuid references public.bookmarks(id),
 add column health_decision jsonb;

create function private.bookmark_health_matches(c public.bookmark_checks,p_type text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(case p_type
  when 'dead' then c.status='dead'
  when 'content' then c.evidence->'content'->>'status' in ('deleted_suspected','changed_suspected')
  when 'media' then c.evidence->'media'->>'status' in ('partial','missing_suspected')
  when 'uncheckable' then c.status in ('restricted','temporary','uncheckable') or
    (c.status<>'dead' and (
      c.evidence->'ai'->>'state' in ('pending','uncertain','failed','not_configured') or
      (coalesce((c.evidence->'content'->>'applicable')::boolean,true) and c.evidence->'content'->>'status' in ('unknown','restricted')) or
      (coalesce((c.evidence->'media'->>'applicable')::boolean,true) and c.evidence->'media'->>'status'='unknown')))
  else false end,false) and c.reviewed_at is null
$$;
revoke all on function private.bookmark_health_matches(public.bookmark_checks,text) from public,anon,authenticated,service_role;

create function private.bookmark_health_keep(b public.bookmarks,p_input jsonb)
returns void language plpgsql set search_path='' as $$
declare c public.bookmark_checks;
begin
 select * into c from public.bookmark_checks where bookmark_id=b.id order by checked_at desc,id limit 1 for update;
 if (c.evidence is not null and c.bookmark_version=b.version and coalesce(c.checked_url,b.url)=b.url) or p_input ? 'evidenceId' then
  if c.id is distinct from nullif(p_input->>'evidenceId','')::uuid
   or (c.evidence is not null and c.evidence_revision is distinct from (p_input->>'evidenceRevision')::integer)
   or c.bookmark_version<>b.version or coalesce(c.checked_url,b.url)<>b.url then
   raise exception 'health evidence changed' using errcode='PT409';
  end if;
 end if;
end $$;
revoke all on function private.bookmark_health_keep(public.bookmarks,jsonb) from public,anon,authenticated,service_role;

do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 marker:='elsif p_action=''keep'' then';
 if position(marker in definition)=0 then raise exception 'bookmark keep boundary changed'; end if;
 definition:=replace(definition,marker,marker||' perform private.bookmark_health_keep(b,p_input);');
 marker:='where bookmark_id=b.id and reviewed_at is null;';
 if position(marker in definition)=0 then raise exception 'bookmark review boundary changed'; end if;
 definition:=replace(definition,marker,'where bookmark_id=b.id and reviewed_at is null and (p_action<>''keep'' or evidence is null or (id=nullif(p_input->>''evidenceId'','''')::uuid and evidence_revision=(p_input->>''evidenceRevision'')::integer));');
 execute definition;
end $$;

create or replace function public.bookmark_review_matches(b public.bookmarks,p_type text)
returns boolean language sql stable security definer set search_path='' as $$
 select case p_type
 when 'classify' then exists(select 1 from public.bookmark_proposals where bookmark_id=b.id and kind='classify' and state='pending')
 when 'unused' then exists(select 1 from public.bookmark_proposals where bookmark_id=b.id and kind='review' and state='pending') or
  ((b.saved_at<now()-interval '180 days' or exists(select 1 from public.bookmarks d where d.url_key=b.url_key and d.id<>b.id and d.state='library'))
   and not exists(select 1 from public.bookmark_events e where e.bookmark_id=b.id and e.kind='keep' and e.created_at>=b.updated_at))
 when 'all' then public.bookmark_review_due(b)
 else coalesce((select private.bookmark_health_matches(c,p_type) and c.bookmark_version=b.version and coalesce(c.checked_url,b.url)=b.url
  from public.bookmark_checks c where c.bookmark_id=b.id order by checked_at desc,id limit 1),false) end
$$;
create or replace function public.bookmark_review_due(p_bookmark public.bookmarks)
returns boolean language sql stable security definer set search_path='' as $$
 select public.bookmark_review_matches(p_bookmark,'dead') or public.bookmark_review_matches(p_bookmark,'content')
 or public.bookmark_review_matches(p_bookmark,'media') or public.bookmark_review_matches(p_bookmark,'uncheckable')
 or public.bookmark_review_matches(p_bookmark,'classify') or public.bookmark_review_matches(p_bookmark,'unused')
$$;

create or replace function public.bookmark_snapshot(p_filter jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_month date:=date_trunc('month',now() at time zone 'Asia/Seoul')::date;
 v_review boolean:=coalesce((p_filter->>'review')::boolean,false); v_type text:=coalesce(p_filter->>'reviewType','all');
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if v_type not in ('all','dead','unused','classify','content','media','uncheckable') then raise exception 'invalid review type' using errcode='22023'; end if;
 with latest as materialized (
  select distinct on(bookmark_id) * from public.bookmark_checks order by bookmark_id,checked_at desc,id
 ), pending as (
  select bookmark_id,bool_or(kind='classify') classify,bool_or(kind='review') unused from public.bookmark_proposals where state='pending' group by bookmark_id
 ), duplicates as (
  select url_key,count(*) n from public.bookmarks where state='library' group by url_key
 ), kept as (
  select bookmark_id,max(created_at) at from public.bookmark_events where kind='keep' group by bookmark_id
 ), evidence as (
  select b.id,b.saved_at,
   coalesce(private.bookmark_health_matches(c,'dead'),false) dead,
   coalesce(private.bookmark_health_matches(c,'content'),false) content,
   coalesce(private.bookmark_health_matches(c,'media'),false) media,
   coalesce(private.bookmark_health_matches(c,'uncheckable'),false) uncheckable,
   coalesce(p.classify,false) classify,
   coalesce(p.unused,false) or ((b.saved_at<now()-interval '180 days' or coalesce(u.n,0)>case when b.state='library' then 1 else 0 end) and (k.at is null or k.at<b.updated_at)) unused
  from public.bookmarks b left join latest c on c.bookmark_id=b.id and c.bookmark_version=b.version and coalesce(c.checked_url,b.url)=b.url
  left join pending p on p.bookmark_id=b.id left join duplicates u on u.url_key=b.url_key left join kept k on k.bookmark_id=b.id
  where (p_filter ? 'id' or b.state=coalesce(p_filter->>'state','library'))
   and (not p_filter ? 'id' or b.id=(p_filter->>'id')::uuid)
   and (not p_filter ? 'collectionId' or b.collection_id is not distinct from nullif(p_filter->>'collectionId','')::uuid)
   and (coalesce(p_filter->>'search','')='' or b.title ilike '%'||(p_filter->>'search')||'%' or b.url ilike '%'||(p_filter->>'search')||'%')
 ), filtered as materialized (
  select id,saved_at,case when dead then 0 when content then 1 when media then 2 when uncheckable then 3 when classify then 4 else 5 end priority
  from evidence where not v_review or case v_type when 'dead' then dead when 'content' then content when 'media' then media
   when 'uncheckable' then uncheckable when 'classify' then classify when 'unused' then unused else dead or content or media or uncheckable or classify or unused end
 ), page as (
  select * from filtered order by case when v_review then priority end,case when v_review then saved_at end asc,saved_at desc,id
  limit least(greatest(coalesce((p_filter->>'limit')::int,50),1),100) offset greatest(coalesce((p_filter->>'offset')::int,0),0)
 )
 select jsonb_build_object(
  'items',(select coalesce(jsonb_agg(public.bookmark_row(b)||jsonb_build_object(
   'duplicate_count',greatest(coalesce(u.n,0)-case when b.state='library' then 1 else 0 end,0),
   'check',(select to_jsonb(c) from latest c where c.bookmark_id=b.id),
   'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id),'[]') from public.bookmark_proposals p where p.bookmark_id=b.id and p.state='pending'),
   'last_review',(select to_jsonb(e) from public.bookmark_events e where e.bookmark_id=b.id and e.kind='keep' order by e.created_at desc,e.id desc limit 1)
  ) order by case when v_review then page.priority end,case when v_review then page.saved_at end asc,page.saved_at desc,page.id),'[]')
  from page join public.bookmarks b on b.id=page.id left join duplicates u on u.url_key=b.url_key),
  'total',(select count(*) from filtered),
  'collections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.id),'[]') from public.bookmark_collections c where c.source_id is distinct from '-1' and c.archived_at is null),
  'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]') from public.bookmark_jobs j where j.kind='import' or j.id in (select id from public.bookmark_jobs order by created_at desc limit 30)),
  'settings',(select to_jsonb(s) from public.bookmark_settings s where s.id),
  'budget',jsonb_build_object('month',v_month,'limit_nano',1000000000,'used_nano',
   (select coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else greatest(reserved_nano,coalesce(charged_nano,0)) end),0) from public.bookmark_ai_reservations where month=v_month))
 ) into v_result;
 return v_result;
end $$;
commit;
