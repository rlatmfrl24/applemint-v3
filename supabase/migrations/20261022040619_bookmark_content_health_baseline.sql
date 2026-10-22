begin;
create function private.bookmark_health_is_baseline(c public.bookmark_checks) returns boolean
language sql stable set search_path='' as $$
 select c.status='healthy' and c.evidence->'content'->>'status'='present' and c.evidence->>'coverage'='complete'
 and c.evidence->'media'->>'status' in ('present','none_detected')
 and exists(select 1 from public.bookmark_job_items i where i.job_id=c.job_id and i.bookmark_id=c.bookmark_id and i.state='done')
$$;
revoke all on function private.bookmark_health_is_baseline(public.bookmark_checks) from public,anon,authenticated,service_role;
do $$ declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.bookmark_worker_claim()'::regprocedure);
 marker:='c.evidence->''content''->>''status''=''present'' and c.evidence->>''coverage''=''complete''';
 if position(marker in definition)=0 then raise exception 'health claim baseline boundary changed'; end if;
 execute replace(definition,marker,'private.bookmark_health_is_baseline(c)');
 definition:=pg_get_functiondef('public.enqueue_bookmark_health_daily()'::regprocedure);
 marker:='evidence->''content''->>''status''=''present'' and evidence->>''coverage''=''complete''';
 if position(marker in definition)=0 then raise exception 'health retention baseline boundary changed'; end if;
 execute replace(definition,marker,'private.bookmark_health_is_baseline(bookmark_checks)');
end $$;
commit;
