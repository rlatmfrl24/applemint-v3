begin;
alter table public.bookmark_ai_reservations add column provider text;
alter table public.bookmark_ai_reservations add column model text;
alter table public.bookmark_ai_reservations add constraint bookmark_request_identity_pair
 check ((provider is null and model is null) or (provider is not null and model is not null and length(btrim(provider)) between 1 and 160 and length(btrim(model)) between 1 and 160));

-- Only a single recorded call proves the job metadata belongs to that request.
update public.bookmark_ai_reservations r set provider=j.progress->>'provider',model=j.progress->>'model'
from public.bookmark_jobs j
where j.id=r.job_id and j.progress->>'provider'='openrouter'
 and j.progress->>'model' in ('openai/gpt-6-luna','typesafe/jev-1.13')
 and (select count(*) from public.bookmark_ai_reservations calls where calls.job_id=j.id)=1;

create function private.bookmark_preserve_request_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.provider is distinct from old.provider or new.model is distinct from old.model then
  raise exception 'request identity is immutable' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function private.bookmark_preserve_request_identity() from public,anon,authenticated,service_role;
create trigger bookmark_request_identity_immutable before update of provider,model on public.bookmark_ai_reservations
for each row execute function private.bookmark_preserve_request_identity();

drop function public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint);
create function public.bookmark_ai_reserve(p_id uuid,p_job uuid,p_lease uuid,p_tokens int,p_amount bigint,p_provider text,p_model text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_month date:=date_trunc('month',now() at time zone 'Asia/Seoul')::date; v_used bigint;
begin
 if p_tokens is null or p_tokens<0 or p_amount is null or p_amount<=0 or p_amount>1000000000
  or p_provider is distinct from 'openrouter' or p_model is null or p_model not in ('openai/gpt-6-luna','typesafe/jev-1.13') then return false; end if;
 perform 1 from public.bookmark_jobs where id=p_job and lease_token=p_lease and state='processing' and lease_expires_at>now() for update;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('bookmark:ai-budget:'||v_month,0));
 if exists(select 1 from public.bookmark_ai_reservations where month=v_month and state<>'released' and charged_nano>reserved_nano) then return false; end if;
 if exists(select 1 from public.bookmark_ai_reservations where id=p_id) then return false; end if;
 select coalesce(sum(case when state='released' then 0 when state='settled' then charged_nano else greatest(reserved_nano,coalesce(charged_nano,0)) end),0) into v_used from public.bookmark_ai_reservations where month=v_month;
 if v_used+p_amount>1000000000 then return false; end if;
 insert into public.bookmark_ai_reservations(id,job_id,month,input_tokens,reserved_nano,provider,model) values(p_id,p_job,v_month,p_tokens,p_amount,p_provider,p_model);
 return true;
end $$;
revoke all on function public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint,text,text) to service_role;

create or replace function public.bookmark_ai_usage() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_month date := date_trunc('month',now() at time zone 'Asia/Seoul')::date; result jsonb;
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 with models as (
  select r.provider,r.model,count(*) requests,
   count(*) filter(where r.state='settled') settled_requests,
   count(*) filter(where r.state in ('reserved','uncertain')) held_requests,
   coalesce(sum(r.charged_nano) filter(where r.state='settled'),0) charged_nano,
   coalesce(sum(greatest(r.reserved_nano,coalesce(r.charged_nano,0))) filter(where r.state in ('reserved','uncertain')),0) held_nano
  from public.bookmark_ai_reservations r where r.month=v_month and r.state<>'released'
  group by r.provider,r.model
 ) select jsonb_build_object(
  'month',v_month,'limitNano',1000000000,'requestCount',coalesce(sum(requests),0),
  'chargedNano',coalesce(sum(charged_nano),0),'heldNano',coalesce(sum(held_nano),0),
  'usedNano',coalesce(sum(charged_nano+held_nano),0),
  'models',coalesce(jsonb_agg(jsonb_build_object('provider',provider,'model',model,'requests',requests,
   'settledRequests',settled_requests,'heldRequests',held_requests,'chargedNano',charged_nano,'heldNano',held_nano)
   order by requests desc,model nulls last,provider nulls last),'[]'::jsonb)
 ) into result from models;
 return result;
end $$;
commit;
