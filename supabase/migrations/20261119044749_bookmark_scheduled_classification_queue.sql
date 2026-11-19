begin;

alter table public.bookmark_settings
 add column classify_auto_enabled boolean not null default false,
 add column classify_daily_limit integer not null default 100 check (classify_daily_limit between 1 and 500),
 add column classify_started_at timestamptz,
 add column classify_last_scan_date date,
 add column classify_last_scan_outcome text check (classify_last_scan_outcome in ('queued','deferred','exhausted'));

create unique index bookmark_scheduled_classification_date_idx
 on public.bookmark_jobs((scope->>'scheduledDate'))
 where kind='classify' and scope->>'origin'='scheduled-classify';
create index bookmark_job_items_bookmark_idx on public.bookmark_job_items(bookmark_id,job_id);

create function private.bookmark_scheduled_classification_open(j public.bookmark_jobs) returns boolean
language sql stable set search_path='' as $$
 select not (j.progress ? 'closedAt') and (
  j.state in ('queued','processing','retry','paused')
  or (j.state in ('failed','partial') and exists (
   select 1 from public.bookmark_job_items i where i.job_id=j.id and i.state in ('pending','waiting','failed')
  ))
 )
$$;

create function private.enqueue_bookmark_scheduled_classification(p_now timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 local_time timestamp:=p_now at time zone 'Asia/Seoul';
 today date:=local_time::date;
 s public.bookmark_settings;
 j public.bookmark_jobs;
 ids uuid[];
 versions integer[];
 outcome text;
 job_id uuid;
begin
 if local_time is null or local_time::time<time '09:00' then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:scheduled-classification',0));
 select * into s from public.bookmark_settings where id;
 if not s.classify_auto_enabled or s.classify_started_at is null or s.classify_last_scan_date>=today
    or s.classify_last_scan_outcome='exhausted' then return null; end if;

 select * into j from public.bookmark_jobs
 where kind='classify' and scope->>'origin'='scheduled-classify' order by scope->>'scheduledDate' desc limit 1;
 if private.bookmark_scheduled_classification_open(j) or (j.scope->>'scheduledDate')::date>=today
    or ((j.progress->>'closedAt')::timestamptz at time zone 'Asia/Seoul')::date>=today then return null; end if;

 with cohort as not materialized (
  select b.id,b.version,b.saved_at from public.bookmarks b
  where b.state='library' and b.created_at<=s.classify_started_at
   and not exists (
    select 1 from public.bookmark_job_items i join public.bookmark_jobs h on h.id=i.job_id
    where i.bookmark_id=b.id and h.kind='classify' and h.scope->>'origin'='scheduled-classify'
   )
 ), chosen as (
  select c.* from cohort c
  where not exists (
   select 1 from public.bookmark_proposals p where p.bookmark_id=c.id
   and p.kind='classify' and p.state='pending' and p.expected_version=c.version
  ) and not exists (
   select 1 from public.bookmark_job_items i join public.bookmark_jobs m on m.id=i.job_id
   where i.bookmark_id=c.id and i.expected_version=c.version and i.state in ('pending','waiting')
   and m.kind='classify' and m.state in ('queued','retry','processing')
  )
  order by c.saved_at,c.id limit s.classify_daily_limit
 )
 select array_agg(id order by saved_at,id),array_agg(version order by saved_at,id),
  case when count(*)>0 then 'queued' when exists(select 1 from cohort) then 'deferred' else 'exhausted' end
 into ids,versions,outcome from chosen;

 if outcome='queued' then
  insert into public.bookmark_jobs(kind,scope,total,progress)
  values('classify',jsonb_build_object('origin','scheduled-classify','scope','selected','scheduledDate',today),
   cardinality(ids),jsonb_build_object('interestVersion',s.interest_version))
  returning id into job_id;
  insert into public.bookmark_job_items(job_id,bookmark_id,expected_version)
  select job_id,b.id,b.version from unnest(ids,versions) as b(id,version);
 end if;
 update public.bookmark_settings set classify_last_scan_date=today,classify_last_scan_outcome=outcome where id;
 return job_id;
end $$;

create function public.bookmark_scheduled_classification_settings() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 today date:=(now() at time zone 'Asia/Seoul')::date;
 s public.bookmark_settings;
 j public.bookmark_jobs;
 status text;
 next_date date;
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 select * into s from public.bookmark_settings where id;
 select * into j from public.bookmark_jobs
 where kind='classify' and scope->>'origin'='scheduled-classify' order by scope->>'scheduledDate' desc limit 1;
 status:=case
  when not s.classify_auto_enabled then 'disabled'
  when private.bookmark_scheduled_classification_open(j) then
   case when j.state in ('paused','failed','partial') then 'blocked' else 'running' end
  when s.classify_last_scan_outcome='exhausted' then 'complete'
  else 'waiting' end;
 if status='waiting' then
  next_date:=greatest(today,s.classify_last_scan_date+1,(j.scope->>'scheduledDate')::date+1,
   ((j.progress->>'closedAt')::timestamptz at time zone 'Asia/Seoul')::date+1);
 end if;
 return jsonb_build_object('enabled',s.classify_auto_enabled,'dailyLimit',s.classify_daily_limit,
  'timeZone','Asia/Seoul','hour',9,'startedAt',s.classify_started_at,
  'nextEligibleAt',(next_date+time '09:00') at time zone 'Asia/Seoul',
  'status',status,'lastJob',case when j.id is not null then to_jsonb(j) end);
end $$;

create function public.bookmark_scheduled_classification_update_settings(p_enabled boolean,p_daily_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if p_enabled is null or p_daily_limit is null or p_daily_limit not between 1 and 500 then
  raise exception 'invalid daily limit' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:scheduled-classification',0));
 update public.bookmark_settings set classify_auto_enabled=p_enabled,classify_daily_limit=p_daily_limit,
  classify_started_at=case when p_enabled then coalesce(classify_started_at,clock_timestamp()) else classify_started_at end
 where id;
 return public.bookmark_scheduled_classification_settings();
end $$;

revoke all on function private.bookmark_scheduled_classification_open(public.bookmark_jobs),
 private.enqueue_bookmark_scheduled_classification(timestamptz),
 public.bookmark_scheduled_classification_settings(),
 public.bookmark_scheduled_classification_update_settings(boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_scheduled_classification_settings(),
 public.bookmark_scheduled_classification_update_settings(boolean,integer) to authenticated;

do $$
declare
 definition text:=pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 boundary text:='elsif p_action=''start'' then';
begin
 if strpos(definition,boundary)=0 then raise exception 'bookmark start boundary changed'; end if;
 execute replace(definition,boundary,boundary||$guard$
  if p_input->>'origin'='scheduled-classify' then raise exception 'reserved job origin' using errcode='22023'; end if;
 $guard$);
end $$;

commit;
