begin;
create function public.bookmark_ai_usage() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_month date := date_trunc('month',now() at time zone 'Asia/Seoul')::date; result jsonb;
begin
 if not coalesce(public.is_applemint_owner(),false) then raise exception 'owner required' using errcode='42501'; end if;
 with models as (
  select nullif(j.progress->>'model','') model,count(*) requests,
   count(*) filter(where r.state='settled') settled_requests,
   count(*) filter(where r.state in ('reserved','uncertain')) held_requests,
   coalesce(sum(r.charged_nano) filter(where r.state='settled'),0) charged_nano,
   coalesce(sum(greatest(r.reserved_nano,coalesce(r.charged_nano,0))) filter(where r.state in ('reserved','uncertain')),0) held_nano
  from public.bookmark_ai_reservations r join public.bookmark_jobs j on j.id=r.job_id
  where r.month=v_month and r.state<>'released'
  group by 1
 ) select jsonb_build_object(
  'month',v_month,'limitNano',1000000000,
  'requestCount',coalesce(sum(requests),0),
  'chargedNano',coalesce(sum(charged_nano),0),'heldNano',coalesce(sum(held_nano),0),
  'usedNano',coalesce(sum(charged_nano+held_nano),0),
  'models',coalesce(jsonb_agg(jsonb_build_object('model',model,'requests',requests,
   'settledRequests',settled_requests,'heldRequests',held_requests,'chargedNano',charged_nano,'heldNano',held_nano)
   order by requests desc,model nulls last),'[]'::jsonb)
 ) into result from models;
 return result;
end $$;
revoke all on function public.bookmark_ai_usage() from public,anon,authenticated,service_role;
grant execute on function public.bookmark_ai_usage() to authenticated;
commit;
