begin;
-- This predicate narrows the new UI groups without changing legacy review filters.
create function private.bookmark_health_problem_matches(c public.bookmark_checks,p_type text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(c.reviewed_at is null and c.evidence->>'confirmation'='repeated' and case p_type
  when 'dead' then c.status='dead' and (c.http_status in (404,410) or c.reason='DNS에서 도메인 부재 확인')
  when 'content' then c.evidence->'content'->>'applicable'='true' and c.evidence->>'coverage'='complete'
   and c.evidence->'content'->>'status' in ('deleted_suspected','changed_suspected')
  when 'media' then c.evidence->'media'->>'status' in ('partial','missing_suspected') and (c.evidence->'media'->>'missing')::integer>0
  else false end,false)
$$;
revoke all on function private.bookmark_health_problem_matches(public.bookmark_checks,text) from public,anon,authenticated,service_role;

create or replace function public.bookmark_snapshot(p_filter jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_month date:=date_trunc('month',now() at time zone 'Asia/Seoul')::date;
 v_review boolean:=coalesce((p_filter->>'review')::boolean,false); v_type text:=coalesce(p_filter->>'reviewType','all');
 v_group text:=p_filter->>'reviewGroup';
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if v_type not in ('all','dead','unused','classify','content','media','uncheckable') then raise exception 'invalid review type' using errcode='22023'; end if;
 if v_group is not null and v_group not in ('problems','attention','organize','classify') then raise exception 'invalid review group' using errcode='22023'; end if;
 with latest as materialized (
  select c.bookmark_id,c.bookmark_version,c.checked_url,to_jsonb(c) check_json,
   private.bookmark_health_matches(c,'dead') health_dead,
   private.bookmark_health_matches(c,'content') health_content,
   private.bookmark_health_matches(c,'media') health_media,
   private.bookmark_health_matches(c,'uncheckable') health_uncheckable,
   case when v_group in ('problems','attention') then private.bookmark_health_problem_matches(c,'dead') else false end problem_dead,
   case when v_group in ('problems','attention') then private.bookmark_health_problem_matches(c,'content') else false end problem_content,
   case when v_group in ('problems','attention') then private.bookmark_health_problem_matches(c,'media') else false end problem_media,
   c.reviewed_at is null and (
    c.evidence->>'confirmation'='pending' or
    ((c.evidence->'content'->>'applicable')::boolean and c.evidence->'content'->>'status'='not_checked') or
    ((c.evidence->'media'->>'applicable')::boolean and c.evidence->'media'->>'status'='not_checked')) incomplete
  from (select distinct on(bookmark_id) * from public.bookmark_checks order by bookmark_id,checked_at desc,id) c
 ), pending as (
  select bookmark_id,bool_or(kind='classify') classify,bool_or(kind='review') unused from public.bookmark_proposals where state='pending' group by bookmark_id
 ), duplicates as (
  select url_key,count(*) n from public.bookmarks where state='library' group by url_key
 ), kept as (
  select bookmark_id,max(created_at) at from public.bookmark_events where kind='keep' group by bookmark_id
 ), evidence as (
  select b.id,b.saved_at,
   coalesce(c.health_dead,false) dead,coalesce(c.health_content,false) content,
   coalesce(c.health_media,false) media,coalesce(c.health_uncheckable,false) uncheckable,
   coalesce(c.problem_dead,false) problem_dead,coalesce(c.problem_content,false) problem_content,coalesce(c.problem_media,false) problem_media,
   coalesce(c.incomplete,false) incomplete,coalesce(p.classify,false) classify,
   coalesce(p.unused,false) or ((b.saved_at<now()-interval '180 days' or coalesce(u.n,0)>case when b.state='library' then 1 else 0 end) and (k.at is null or k.at<b.updated_at)) unused
  from public.bookmarks b left join latest c on c.bookmark_id=b.id and c.bookmark_version=b.version and coalesce(c.checked_url,b.url)=b.url
  left join pending p on p.bookmark_id=b.id left join duplicates u on u.url_key=b.url_key left join kept k on k.bookmark_id=b.id
  where (p_filter ? 'id' or b.state=coalesce(p_filter->>'state','library'))
   and (not p_filter ? 'id' or b.id=(p_filter->>'id')::uuid)
   and (not p_filter ? 'collectionId' or b.collection_id is not distinct from nullif(p_filter->>'collectionId','')::uuid)
   and (coalesce(p_filter->>'search','')='' or b.title ilike '%'||(p_filter->>'search')||'%' or b.url ilike '%'||(p_filter->>'search')||'%')
 ), filtered as materialized (
  select id,saved_at,case when dead then 0 when content then 1 when media then 2 when uncheckable then 3 when classify then 4 else 5 end priority
  from evidence where not v_review or case v_group
   when 'problems' then case v_type when 'dead' then problem_dead when 'content' then problem_content when 'media' then problem_media else problem_dead or problem_content or problem_media end
   when 'attention' then (dead or content or media or uncheckable or incomplete) and not (problem_dead or problem_content or problem_media)
   when 'organize' then unused when 'classify' then classify
   else case v_type when 'dead' then dead when 'content' then content when 'media' then media
   when 'uncheckable' then uncheckable when 'classify' then classify when 'unused' then unused else dead or content or media or uncheckable or classify or unused end end
 ), page as (
  select * from filtered order by case when v_review then priority end,case when v_review then saved_at end asc,saved_at desc,id
  limit least(greatest(coalesce((p_filter->>'limit')::int,50),1),100) offset greatest(coalesce((p_filter->>'offset')::int,0),0)
 )
 select jsonb_build_object(
  'items',(select coalesce(jsonb_agg(public.bookmark_row(b)||jsonb_build_object(
   'duplicate_count',greatest(coalesce(u.n,0)-case when b.state='library' then 1 else 0 end,0),
   'check',page_check.check_json,
   'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id),'[]') from public.bookmark_proposals p where p.bookmark_id=b.id and p.state='pending'),
   'last_review',(select to_jsonb(e) from public.bookmark_events e where e.bookmark_id=b.id and e.kind='keep' order by e.created_at desc,e.id desc limit 1)
  ) order by case when v_review then page.priority end,case when v_review then page.saved_at end asc,page.saved_at desc,page.id),'[]')
  from page join public.bookmarks b on b.id=page.id left join duplicates u on u.url_key=b.url_key
  left join latest page_check on page_check.bookmark_id=b.id),
  'total',(select count(*) from filtered),
  'collections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.id),'[]') from public.bookmark_collections c where c.source_id is distinct from '-1' and c.archived_at is null),
  'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]') from public.bookmark_jobs j where j.kind='import' or j.id in (select id from public.bookmark_jobs order by created_at desc limit 30)),
  'settings',(select to_jsonb(s) from public.bookmark_settings s where s.id),
  'budget',jsonb_build_object('month',v_month,'limit_nano',1000000000,'used_nano',
   (select coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else greatest(reserved_nano,coalesce(charged_nano,0)) end),0) from public.bookmark_ai_reservations where month=v_month))
 ) into v_result;
 return v_result;
end $$;

notify pgrst,'reload schema';
commit;
