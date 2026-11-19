begin;

create function public.bookmark_scheduled_classification_close(p_id uuid,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 j public.bookmark_jobs;
 done_count integer;
 failed_count integer;
 reason constant text:='소유자가 회차를 종료했습니다.';
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 if p_confirmed is distinct from true then raise exception 'round closure requires confirmation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:scheduled-classification',0));
 select * into j from public.bookmark_jobs where id=p_id for update;
 if not found then raise exception 'job not found' using errcode='P0002'; end if;
 if j.kind<>'classify' or j.scope->>'origin' is distinct from 'scheduled-classify'
    or j.state not in ('paused','failed','partial') or j.progress ? 'closedAt'
    or j.lease_expires_at>clock_timestamp() then
  raise exception 'scheduled round cannot close' using errcode='PT409';
 end if;

 update public.bookmark_job_items set state='failed',error=reason where job_id=p_id and state in ('pending','waiting');
 select count(*) filter(where state='done'),count(*) filter(where state='failed') into done_count,failed_count
 from public.bookmark_job_items where job_id=p_id;
 update public.bookmark_jobs set state=case when done_count>0 then 'partial' else 'failed' end,
  progress=progress||jsonb_build_object('closedAt',clock_timestamp()),
  completed=done_count,failed=failed_count,error=coalesce(error,reason),
  lease_token=null,lease_expires_at=null,updated_at=now()
 where id=p_id returning * into j;
 return to_jsonb(j);
end $$;

revoke all on function public.bookmark_scheduled_classification_close(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_scheduled_classification_close(uuid,boolean) to authenticated;

do $$
declare
 definition text:=pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 marker text:=$resume$elsif p_action='resume' then$resume$;
begin
 if strpos(definition,marker)=0 then raise exception 'bookmark resume boundary changed'; end if;
 definition:=replace(definition,marker,marker||$lock$
  if exists(select 1 from public.bookmark_jobs where id=(p_input->>'id')::uuid
    and kind='classify' and scope->>'origin'='scheduled-classify') then
   perform pg_advisory_xact_lock(hashtextextended('bookmark:scheduled-classification',0));
  end if;
 $lock$);
 marker:=$state$if j.state not in ('failed','partial','paused') then raise exception 'job cannot resume' using errcode='PT409'; end if;$state$;
 if strpos(definition,marker)=0 then raise exception 'bookmark resume state boundary changed'; end if;
 execute replace(definition,marker,marker||$guard$
  if j.kind='classify' and j.scope->>'origin'='scheduled-classify' and (
   j.progress ? 'closedAt' or j.lease_expires_at>clock_timestamp()
   or exists(select 1 from public.bookmark_jobs other where other.id<>j.id
    and other.kind='classify' and other.scope->>'origin'='scheduled-classify'
    and private.bookmark_scheduled_classification_open(other))
  ) then raise exception 'scheduled round cannot resume' using errcode='PT409'; end if;
 $guard$);
end $$;

create or replace function public.dispatch_bookmark_worker()
returns void language plpgsql security definer set search_path='' as $$
declare v_base text; v_secret text;
begin
 perform public.enqueue_bookmark_health_daily();
 select decrypted_secret into v_base from vault.decrypted_secrets where name in ('bookmark_app_base_url','crawl_app_base_url')
 order by (name='bookmark_app_base_url') desc,created_at desc limit 1;
 select decrypted_secret into v_secret from vault.decrypted_secrets where name in ('bookmark_internal_secret','crawl_internal_secret')
 order by (name='bookmark_internal_secret') desc,created_at desc limit 1;
 if nullif(btrim(v_base),'') is null or nullif(btrim(v_secret),'') is null then return; end if;
 perform private.enqueue_bookmark_scheduled_classification(now());
 if not exists (
  select 1 from public.bookmark_jobs j
  where ((j.state in ('queued','retry') and j.available_at<=now()) or (j.state='processing' and j.lease_expires_at<=now()))
   and (j.kind<>'classify' or j.scope->>'origin' is distinct from 'scheduled-classify'
    or private.bookmark_scheduled_classification_claimable(j))
 ) then return; end if;
 perform net.http_post(url:=rtrim(v_base,'/')||'/api/bookmarks/worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-applemint-internal-secret',v_secret),
  body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;

commit;
