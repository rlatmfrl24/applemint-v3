begin;
create table private.bookmark_health_hosts (
 host text primary key check(length(host) between 1 and 253),
 lease_token uuid, lease_expires_at timestamptz, next_allowed_at timestamptz not null default now()
);
alter table private.bookmark_health_hosts enable row level security;
revoke all on table private.bookmark_health_hosts from public,anon,authenticated,service_role;
create function public.bookmark_health_host_claim(p_host text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h private.bookmark_health_hosts;
begin
 insert into private.bookmark_health_hosts(host,lease_token,lease_expires_at) values(lower(p_host),gen_random_uuid(),now()+interval '15 seconds')
 on conflict(host) do update set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '15 seconds'
 where bookmark_health_hosts.next_allowed_at<=now() and (bookmark_health_hosts.lease_expires_at is null or bookmark_health_hosts.lease_expires_at<=now()) returning * into h;
 if found then return jsonb_build_object('token',h.lease_token,'retryAt',h.lease_expires_at); end if;
 select * into h from private.bookmark_health_hosts where host=lower(p_host);
 return jsonb_build_object('token',null,'retryAt',greatest(h.next_allowed_at,coalesce(h.lease_expires_at,now()+interval '2 seconds')));
end $$;
create function public.bookmark_health_host_release(p_host text,p_token uuid,p_retry_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.bookmark_health_hosts set lease_token=null,lease_expires_at=null,next_allowed_at=greatest(now()+interval '2 seconds',least(p_retry_at,now()+interval '24 hours'))
 where host=lower(p_host) and lease_token=p_token;
 return found;
end $$;

create function public.bookmark_health_ai_reserve(p_job uuid,p_lease uuid,p_bookmark uuid,p_reservation uuid,p_evidence_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.bookmark_ai_reservations; next_month timestamptz := (date_trunc('month',now() at time zone 'Asia/Seoul')+interval '1 month') at time zone 'Asia/Seoul';
begin
 perform 1 from public.bookmark_jobs where id=p_job and kind='check' and state='processing' and lease_token=p_lease and lease_expires_at>now() for update;
 if not found then raise exception 'health job changed' using errcode='PT409'; end if;
 perform 1 from public.bookmark_job_items i join public.bookmarks b on b.id=i.bookmark_id
 where i.job_id=p_job and i.bookmark_id=p_bookmark and i.state in ('pending','waiting') and i.expected_version=b.version and b.state='library';
 if not found or p_evidence_key !~ '^[a-f0-9]{64}$' then raise exception 'health evidence changed' using errcode='PT409'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:health-ai:'||p_evidence_key,0));
 select * into r from public.bookmark_ai_reservations where health_evidence_key=p_evidence_key for update;
 if found then
  if r.health_bookmark_id is distinct from p_bookmark then raise exception 'health evidence changed' using errcode='PT409'; end if;
  return jsonb_build_object('state',case when r.state='settled' and r.health_decision is not null then 'cached' when r.state='settled' then 'output_failed' else 'uncertain' end,'reservationId',r.id,'decision',r.health_decision,'retryAt',null);
 end if;
 if not public.bookmark_ai_reserve(p_reservation,p_job,p_lease,65536,2752512,'openrouter','typesafe/jev-1.13') then
  return jsonb_build_object('state','budget_wait','reservationId',null,'decision',null,'retryAt',next_month);
 end if;
 update public.bookmark_ai_reservations set health_evidence_key=p_evidence_key,health_bookmark_id=p_bookmark where id=p_reservation;
 update public.bookmark_job_items set work=coalesce(work,'{}')||jsonb_build_object('reservationId',p_reservation,'evidenceKey',p_evidence_key) where job_id=p_job and bookmark_id=p_bookmark;
 return jsonb_build_object('state','reserved','reservationId',p_reservation,'decision',null,'retryAt',null);
end $$;
create function public.bookmark_health_ai_settle(p_reservation uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.bookmark_ai_reservations; amount bigint:=nullif(p_result->>'chargedNano','')::bigint;
begin
 select * into r from public.bookmark_ai_reservations where id=p_reservation and health_evidence_key is not null;
 if not found then return false; end if;
 perform 1 from public.bookmark_jobs where id=r.job_id for update;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:ai-budget:'||r.month,0));
 select * into r from public.bookmark_ai_reservations where id=p_reservation for update;
 if r.state='settled' then return amount is null or amount=r.charged_nano; end if;
 if amount<0 or (r.charged_nano is not null and amount is not null and r.charged_nano<>amount) then return false; end if;
 update public.bookmark_ai_reservations set charged_nano=coalesce(amount,charged_nano),
  state=case when amount is not null and amount<=reserved_nano and p_result->>'state'='settled' then 'settled' else 'uncertain' end,
  output_tokens=coalesce(nullif(p_result->>'outputTokens','')::int,output_tokens),
  health_decision=case when amount is not null and amount<=reserved_nano and p_result->>'state'='settled' and p_result->'decision' is not null and p_result->'decision'<>'null'::jsonb then p_result->'decision' else health_decision end
 where id=p_reservation;
 return true;
end $$;
revoke all on function public.bookmark_health_host_claim(text),public.bookmark_health_host_release(text,uuid,timestamptz),public.bookmark_health_ai_reserve(uuid,uuid,uuid,uuid,text),public.bookmark_health_ai_settle(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_health_host_claim(text),public.bookmark_health_host_release(text,uuid,timestamptz),public.bookmark_health_ai_reserve(uuid,uuid,uuid,uuid,text),public.bookmark_health_ai_settle(uuid,jsonb) to service_role;

create function private.bookmark_health_recover(p_job uuid) returns boolean language plpgsql set search_path='' as $$
declare pending_count integer; failed_count integer; done_count integer;
begin
 update public.bookmark_ai_reservations set state='uncertain' where job_id=p_job and health_bookmark_id is not null and state='reserved';
 update public.bookmark_job_items i set state='failed',error='이전 AI 응답을 확인하지 못해 예약을 유지합니다. 자동 재호출하지 않습니다.'
 where job_id=p_job and i.state in ('pending','waiting') and exists(select 1 from public.bookmark_ai_reservations r where r.id=nullif(i.work->>'reservationId','')::uuid and r.state='uncertain');
 select count(*) filter(where state in ('pending','waiting')),count(*) filter(where state='failed'),count(*) filter(where state='done') into pending_count,failed_count,done_count from public.bookmark_job_items where job_id=p_job;
 if pending_count=0 then
  update public.bookmark_jobs set state=case when failed_count=0 then 'succeeded' when done_count=0 then 'failed' else 'partial' end,failed=failed_count,completed=done_count,lease_token=null,lease_expires_at=null,updated_at=now() where id=p_job;
  return false;
 end if;
 return true;
end $$;
revoke all on function private.bookmark_health_recover(uuid) from public,anon,authenticated,service_role;

-- Keep non-check claim semantics, including the established AI crash/collection guards.
do $$
declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.bookmark_worker_claim()'::regprocedure);
 marker:='order by available_at,created_at,id for update skip locked limit 1;';
 if position(marker in definition)=0 then raise exception 'bookmark claim boundary changed'; end if;
 definition:=replace(definition,marker,'and (kind<>''check'' or exists(select 1 from public.bookmark_job_items i where i.job_id=bookmark_jobs.id and i.state in (''pending'',''waiting'') and i.available_at<=now())) '||marker);
 marker:='update public.bookmark_jobs set state=''processing'',lease_token';
 if position(marker in definition)=0 then raise exception 'bookmark health recovery boundary changed'; end if;
 definition:=replace(definition,marker,'if j.kind=''check'' and j.state=''processing'' and not private.bookmark_health_recover(j.id) then return public.bookmark_worker_claim(); end if; '||marker);
 marker:='''expected_version'',i.expected_version,''previous'',i.result,';
 if position(marker in definition)=0 then raise exception 'bookmark health checkpoint boundary changed'; end if;
 definition:=replace(definition,marker,marker||$fields$'work',i.work,'baseline',(select jsonb_build_object('checkId',c.id,'url',c.checked_url,'observedAt',c.checked_at,'title',c.evidence->'content'->>'title','textHash',c.evidence->'content'->>'textHash','textLength',(c.evidence->'content'->>'textLength')::int,'mediaReachable',(c.evidence->'media'->>'reachable')::int)
 from public.bookmark_checks c where c.bookmark_id=b.id and c.checked_url=b.url and c.evidence->'content'->>'status'='present' and c.evidence->>'coverage'='complete' order by c.checked_at desc,c.id limit 1),$fields$);
 execute definition;
end $$;

alter function public.bookmark_worker_commit(uuid,uuid,jsonb) set schema private;
alter function private.bookmark_worker_commit(uuid,uuid,jsonb) rename to bookmark_worker_commit_legacy;
revoke all on function private.bookmark_worker_commit_legacy(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.bookmark_worker_commit(p_job uuid,p_lease uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.bookmark_jobs; b public.bookmarks; v jsonb; next_state text; pending_count integer; done_count integer; failed_count integer; observed_at timestamptz;
begin
 if p_result ? 'receipt' then perform public.bookmark_health_ai_settle((p_result->'receipt'->>'reservationId')::uuid,p_result->'receipt'->'result'); end if;
 select * into j from public.bookmark_jobs where id=p_job;
 if j.kind is distinct from 'check' then return private.bookmark_worker_commit_legacy(p_job,p_lease,p_result); end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('bookmark:collection-lifecycle',0));
 select * into j from public.bookmark_jobs where id=p_job and state='processing' and lease_token=p_lease and lease_expires_at>now() for update;
 if not found then return false; end if;
 for v in select value from jsonb_array_elements(coalesce(p_result->'items','[]')) order by value->>'id' loop
  if not exists(select 1 from public.bookmark_job_items where job_id=j.id and bookmark_id=(v->>'id')::uuid and state in ('pending','waiting')) then raise exception 'unexpected job item' using errcode='22023'; end if;
  select * into b from public.bookmarks where id=(v->>'id')::uuid for update;
  if b.version is distinct from (v->>'version')::int or b.state<>'library' or (v ? 'check' and coalesce(v->'check'->>'checkedUrl',b.url)<>b.url) then
   v:=(v-'check')||jsonb_build_object('state','failed','error','북마크가 변경되어 이전 검사 결과를 적용하지 않았습니다.');
  end if;
  if v ? 'check' then
   observed_at:=coalesce((v->'check'->'evidence'->>'observedAt')::timestamptz,now());
   insert into public.bookmark_checks(bookmark_id,job_id,bookmark_version,status,reason,final_url,http_status,checked_url,evidence,checked_at)
   values(b.id,j.id,(v->>'version')::int,v->'check'->>'status',v->'check'->>'reason',v->'check'->>'finalUrl',nullif(v->'check'->>'httpStatus','')::int,coalesce(v->'check'->>'checkedUrl',b.url),v->'check'->'evidence',observed_at)
   on conflict(job_id,bookmark_id) do update set status=excluded.status,reason=excluded.reason,final_url=excluded.final_url,http_status=excluded.http_status,
    evidence=excluded.evidence,checked_at=excluded.checked_at,evidence_revision=bookmark_checks.evidence_revision+1,reviewed_at=null
   where bookmark_checks.checked_at<=excluded.checked_at;
  end if;
  update public.bookmark_job_items set state=coalesce(v->>'state','done'),work=case when v ? 'work' then nullif(v->'work','null'::jsonb) else work end,result=coalesce(v->'result',result),error=v->>'error',
   available_at=coalesce((v->>'availableAt')::timestamptz,case when v->>'state'='waiting' then now()+interval '1 minute' else now() end)
   where job_id=j.id and bookmark_id=b.id;
 end loop;
 select count(*) filter(where state in ('pending','waiting')),count(*) filter(where state='failed'),count(*) filter(where state='done') into pending_count,failed_count,done_count from public.bookmark_job_items where job_id=j.id;
 next_state:=case when pending_count>0 then 'retry' when failed_count=0 then 'succeeded' when done_count=0 then 'failed' else 'partial' end;
 update public.bookmark_jobs set state=case when p_result->>'state' in ('paused','failed') then p_result->>'state' else next_state end,
  completed=done_count,failed=failed_count,progress=progress||coalesce(p_result->'progress','{}')||jsonb_build_object(
   'unknownCount',(select count(*) from public.bookmark_checks c where c.job_id=j.id and private.bookmark_health_matches(c,'uncheckable')),
   'aiPendingCount',(select count(*) from public.bookmark_job_items i where i.job_id=j.id and i.state='waiting' and i.work->>'phase'='decision')),
  error=p_result->>'error',available_at=coalesce((select min(available_at) from public.bookmark_job_items where job_id=j.id and state in ('pending','waiting')),now()),
  lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function public.bookmark_worker_commit(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_worker_commit(uuid,uuid,jsonb) to service_role;

update public.bookmark_jobs set state='paused',lease_token=null,lease_expires_at=null,error='검사 방식이 변경되었습니다. 같은 작업을 재개해주세요.',updated_at=now()
where kind='check' and state in ('queued','retry','processing');
commit;
