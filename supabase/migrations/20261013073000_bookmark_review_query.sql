begin;
-- Aggregate review evidence once before pagination; row-by-row scans time out on imported libraries.
create or replace function public.bookmark_snapshot(p_filter jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_result jsonb;
 v_month date := date_trunc('month',now() at time zone 'Asia/Seoul')::date;
 v_review boolean := coalesce((p_filter->>'review')::boolean,false);
 v_type text := coalesce(p_filter->>'reviewType','all');
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if v_type not in ('all','dead','unused','classify') then raise exception 'invalid review type' using errcode='22023'; end if;
 with latest_check_times as (
  select bookmark_id,max(checked_at) checked_at from public.bookmark_checks group by bookmark_id
 ), dead as (
  select c.bookmark_id,c.bookmark_version from public.bookmark_checks c
  join latest_check_times t using(bookmark_id,checked_at)
  where c.status='dead' and c.reviewed_at is null group by c.bookmark_id,c.bookmark_version
 ), pending as (
  select bookmark_id,bool_or(kind='classify') classify,bool_or(kind='review') unused
  from public.bookmark_proposals where state='pending' group by bookmark_id
 ), duplicates as (
  select url_key,count(*) n from public.bookmarks where state='library' group by url_key
 ), kept as (
  select bookmark_id,max(created_at) at from public.bookmark_events where kind='keep' group by bookmark_id
 ), evidence as (
  select b.id,b.saved_at,
   d.bookmark_id is not null dead,coalesce(p.classify,false) classify,
   coalesce(p.unused,false) or ((b.saved_at<now()-interval '180 days' or coalesce(u.n,0)>case when b.state='library' then 1 else 0 end)
    and (k.at is null or k.at<b.updated_at)) unused
  from public.bookmarks b
  left join dead d on d.bookmark_id=b.id and d.bookmark_version=b.version
  left join pending p on p.bookmark_id=b.id
  left join duplicates u on u.url_key=b.url_key
  left join kept k on k.bookmark_id=b.id
  where (p_filter ? 'id' or b.state=coalesce(p_filter->>'state','library'))
   and (not p_filter ? 'id' or b.id=(p_filter->>'id')::uuid)
   and (not p_filter ? 'collectionId' or b.collection_id is not distinct from nullif(p_filter->>'collectionId','')::uuid)
   and (coalesce(p_filter->>'search','')='' or b.title ilike '%'||(p_filter->>'search')||'%' or b.url ilike '%'||(p_filter->>'search')||'%')
 ), filtered as materialized (
  select id,saved_at,case when dead then 0 when classify then 1 else 2 end priority from evidence
  where not v_review or case v_type when 'dead' then dead when 'classify' then classify when 'unused' then unused else dead or classify or unused end
 ), page as (
  select * from filtered
  order by case when v_review then priority end,case when v_review then saved_at end asc,saved_at desc,id
  limit least(greatest(coalesce((p_filter->>'limit')::int,50),1),100)
  offset greatest(coalesce((p_filter->>'offset')::int,0),0)
 )
 select jsonb_build_object(
  'items',(select coalesce(jsonb_agg(public.bookmark_row(b)||jsonb_build_object(
    'duplicate_count',greatest(coalesce(u.n,0)-case when b.state='library' then 1 else 0 end,0),
    'check',(select to_jsonb(c) from public.bookmark_checks c where c.bookmark_id=b.id order by c.checked_at desc,c.id limit 1),
    'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id),'[]') from public.bookmark_proposals p where p.bookmark_id=b.id and p.state='pending'),
    'last_review',(select to_jsonb(e) from public.bookmark_events e where e.bookmark_id=b.id and e.kind='keep' order by e.created_at desc,e.id desc limit 1)
   ) order by case when v_review then page.priority end,case when v_review then page.saved_at end asc,page.saved_at desc,page.id),'[]')
   from page join public.bookmarks b on b.id=page.id left join duplicates u on u.url_key=b.url_key),
  'total',(select count(*) from filtered),
  'collections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.id),'[]') from public.bookmark_collections c where c.source_id is distinct from '-1' and c.archived_at is null),
  'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]') from public.bookmark_jobs j where j.kind='import' or j.id in (select id from public.bookmark_jobs order by created_at desc limit 30)),
  'settings',(select to_jsonb(s) from public.bookmark_settings s where s.id),
  'budget',jsonb_build_object('month',v_month,'limit_nano',1000000000,'used_nano',
   (select coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else reserved_nano end),0) from public.bookmark_ai_reservations where month=v_month))
 ) into v_result;
 return v_result;
end $$;
commit;
