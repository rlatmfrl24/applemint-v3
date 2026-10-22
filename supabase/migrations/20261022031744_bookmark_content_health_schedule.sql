begin;
create unique index bookmark_health_automatic_date_idx on public.bookmark_jobs((scope->>'automaticDate')) where kind='check' and scope->>'origin'='automatic';
create function public.bookmark_health_settings() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 return (select jsonb_build_object('enabled',s.health_auto_enabled,'dailyLimit',s.health_daily_limit,'timeZone','Asia/Seoul','hour',9,
 'workerConfigured',exists(select 1 from vault.decrypted_secrets where name in ('bookmark_app_base_url','crawl_app_base_url') and length(decrypted_secret)>0) and exists(select 1 from vault.decrypted_secrets where name in ('bookmark_internal_secret','crawl_internal_secret') and length(decrypted_secret)>0),
 'lastAutomaticJob',(select to_jsonb(j) from public.bookmark_jobs j where j.kind='check' and j.scope->>'origin'='automatic' order by created_at desc,id limit 1)) from public.bookmark_settings s where id);
end $$;
create function public.bookmark_health_update_settings(p_enabled boolean,p_daily_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if p_enabled is null or p_daily_limit is null or p_daily_limit not between 1 and 1000 then raise exception 'invalid daily limit' using errcode='22023'; end if;
 update public.bookmark_settings set health_auto_enabled=p_enabled,health_daily_limit=p_daily_limit where id;
 return public.bookmark_health_settings();
end $$;
revoke all on function public.bookmark_health_settings(),public.bookmark_health_update_settings(boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_health_settings(),public.bookmark_health_update_settings(boolean,integer) to authenticated;

create function private.bookmark_health_active(p_bookmark uuid,p_version integer) returns uuid language sql stable set search_path='' as $$
 select i.job_id from public.bookmark_job_items i join public.bookmark_jobs j on j.id=i.job_id
 where i.bookmark_id=p_bookmark and i.expected_version=p_version and j.kind='check' and j.state in ('queued','retry','processing')
 and i.state in ('pending','waiting') and coalesce(i.work->>'phase','page') in ('page','media','confirm') order by j.created_at,j.id limit 1
$$;
create function private.bookmark_health_start(p_scope jsonb) returns jsonb language plpgsql set search_path='' as $$
declare ids uuid[]; fresh_ids uuid[]; reused_jobs uuid[]; j public.bookmark_jobs; requested integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('bookmark:health-start',0));
 if p_scope->>'scope'='collection' then perform public.bookmark_assert_collection(nullif(p_scope->>'collectionId','')::uuid); end if;
 select array_agg(b.id order by b.id),array_agg(b.id order by b.id) filter(where private.bookmark_health_active(b.id,b.version) is null),array_agg(distinct private.bookmark_health_active(b.id,b.version)) filter(where private.bookmark_health_active(b.id,b.version) is not null)
 into ids,fresh_ids,reused_jobs from public.bookmarks b where b.state='library'
 and (coalesce(p_scope->>'scope','all')<>'collection' or b.collection_id is not distinct from nullif(p_scope->>'collectionId','')::uuid)
 and (coalesce(p_scope->>'scope','all')<>'selected' or b.id in(select value::uuid from jsonb_array_elements_text(p_scope->'ids')));
 requested:=coalesce(cardinality(ids),0);
 if coalesce(cardinality(fresh_ids),0)>0 then
  insert into public.bookmark_jobs(kind,scope,total) values('check',p_scope,cardinality(fresh_ids)) returning * into j;
  insert into public.bookmark_job_items(job_id,bookmark_id,expected_version) select j.id,b.id,b.version from public.bookmarks b where b.id=any(fresh_ids);
 end if;
 return jsonb_build_object('job',case when j.id is null then null else to_jsonb(j) end,'requestedCount',requested,'queuedCount',coalesce(cardinality(fresh_ids),0),'reusedCount',requested-coalesce(cardinality(fresh_ids),0),'activeJobIds',to_jsonb(coalesce(reused_jobs,'{}'::uuid[])));
end $$;

create function private.bookmark_health_due(p_now timestamptz,p_limit integer) returns table(bookmark_id uuid,decision_sample boolean)
language sql stable set search_path='' as $$
 with latest as materialized(select distinct on (c.bookmark_id) c.* from public.bookmark_checks c order by c.bookmark_id,c.checked_at desc,c.id),
 candidates as materialized(
 select b.id,b.saved_at,c.checked_at,substring(b.url from '^https?://([^/]+)') host,
  case when c.id is null or c.bookmark_version<>b.version or c.checked_url is distinct from b.url then 'general'
   when c.status='dead' or c.evidence->'content'->>'status' in ('deleted_suspected','changed_suspected') or c.evidence->'media'->>'status' in ('partial','missing_suspected') then 'suspect'
   when c.status<>'healthy' or c.evidence is null or c.evidence->'content'->>'status' in ('unknown','restricted','not_checked') or c.evidence->'media'->>'status'='unknown' then 'unknown'
   else 'normal' end category
 from public.bookmarks b left join latest c on c.bookmark_id=b.id
 where b.state='library' and private.bookmark_health_active(b.id,b.version) is null and extract(hour from p_now at time zone 'Asia/Seoul')>=9
 ),
 normal_ranked as (
 select *,row_number() over(partition by host order by md5((p_now at time zone 'Asia/Seoul')::date::text||id::text),id) domain_rank
 from candidates where category='normal' and checked_at<=p_now-interval '7 days'
 ), samples as materialized(
 select id,row_number() over(order by domain_rank,md5((p_now at time zone 'Asia/Seoul')::date::text||id::text),id) sample_rank from normal_ranked
 order by domain_rank,md5((p_now at time zone 'Asia/Seoul')::date::text||id::text),id limit floor(p_limit*0.1)::int
 ), suspects as materialized(
 select id from candidates where (category='suspect' and checked_at<=p_now-interval '30 days') or (category='unknown' and checked_at<=p_now-interval '7 days')
 order by checked_at,saved_at,id limit floor(p_limit*0.2)::int
 ), general as (
 select id,false decision_sample,3 bucket,checked_at,saved_at from candidates c
 where c.id not in(select id from samples union all select id from suspects)
 and (category='general' or (category='normal' and checked_at<=p_now-interval '90 days') or (category='suspect' and checked_at<=p_now-interval '30 days') or (category='unknown' and checked_at<=p_now-interval '7 days'))
 ), selected as (
 select s.id,s.sample_rank<=10 decision_sample,1 bucket,c.checked_at,c.saved_at from samples s join candidates c on c.id=s.id
 union all select s.id,false,2,c.checked_at,c.saved_at from suspects s join candidates c on c.id=s.id
 union all select * from general
 ) select id,decision_sample from selected order by bucket,checked_at nulls first,saved_at,id limit greatest(0,least(p_limit,1000))
$$;

create function public.enqueue_bookmark_health_daily() returns uuid language plpgsql security definer set search_path='' as $$
declare today text:=(now() at time zone 'Asia/Seoul')::date::text; lim integer; ids uuid[]; samples uuid[]; result jsonb;
begin
 select health_daily_limit into lim from public.bookmark_settings where id and health_auto_enabled;
 if lim is null or extract(hour from now() at time zone 'Asia/Seoul')<9 then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:health-daily:'||today,0));
 if exists(select 1 from public.bookmark_jobs where kind='check' and scope->>'origin'='automatic' and scope->>'automaticDate'=today) then return null; end if;
 if exists(select 1 from public.bookmark_job_items i join public.bookmark_jobs j on j.id=i.job_id where j.kind='check' and j.scope->>'origin'='automatic' and j.state in ('queued','retry','processing','paused') and i.state in ('pending','waiting') and coalesce(i.work->>'phase','page')<>'decision') then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:health-start',0));
 select array_agg(bookmark_id),array_agg(bookmark_id) filter(where decision_sample) into ids,samples from private.bookmark_health_due(now(),lim);
 if coalesce(cardinality(ids),0)=0 then return null; end if;
 result:=private.bookmark_health_start(jsonb_build_object('origin','automatic','automaticDate',today,'scope','selected','ids',to_jsonb(ids),'decisionSampleIds',to_jsonb(coalesce(samples,'{}'::uuid[]))));
 -- Retain the latest observation, latest normal baseline, and every user-referenced observation.
 with latest as(select distinct on(bookmark_id) id from public.bookmark_checks order by bookmark_id,checked_at desc,id),
 baseline as(select distinct on(bookmark_id,checked_url) id from public.bookmark_checks where evidence->'content'->>'status'='present' and evidence->>'coverage'='complete' order by bookmark_id,checked_url,checked_at desc,id),
 expired as(select c.id from public.bookmark_checks c join public.bookmark_jobs j on j.id=c.job_id where c.evidence is not null and c.checked_at<now()-interval '30 days' and j.state in ('succeeded','failed','partial') and c.id not in(select id from latest union all select id from baseline) and not exists(select 1 from public.bookmark_events e where e.evidence_id=c.id) and not exists(select 1 from public.bookmark_checks d where d.evidence->>'baselineCheckId'=c.id::text) order by c.checked_at,c.id limit 500)
 update public.bookmark_checks set evidence=null from expired where bookmark_checks.id=expired.id;
 return nullif(result->'job'->>'id','')::uuid;
end $$;
revoke all on function private.bookmark_health_active(uuid,integer),private.bookmark_health_start(jsonb),private.bookmark_health_due(timestamptz,integer),public.enqueue_bookmark_health_daily() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_bookmark_health_daily() to service_role;

do $$ declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 marker:='elsif p_action=''start'' then';
 if position(marker in definition)=0 then raise exception 'bookmark start boundary changed'; end if;
 definition:=replace(definition,marker,marker||' if p_input->>''kind''=''check'' then return private.bookmark_health_start((p_input-''origin''-''automaticDate''-''decisionSampleIds'')||jsonb_build_object(''origin'',''manual'')); end if;');
 execute definition;
 definition:=pg_get_functiondef('public.bookmark_worker_claim()'::regprocedure);
 marker:='order by available_at,created_at,id for update skip locked limit 1;';
 if position(marker in definition)=0 then raise exception 'bookmark priority boundary changed'; end if;
 definition:=replace(definition,marker,'and (scope->>''origin'' is distinct from ''automatic'' or (select health_auto_enabled from public.bookmark_settings where id)) order by case when kind=''recommend'' then 0 when scope->>''origin''=''automatic'' then 2 else 1 end,available_at,created_at,id for update skip locked limit 1;');
 execute definition;
 definition:=pg_get_functiondef('public.dispatch_bookmark_worker()'::regprocedure);
 marker:='begin';
 definition:=replace(definition,marker,marker||' perform public.enqueue_bookmark_health_daily();');
 execute definition;
end $$;
commit;
