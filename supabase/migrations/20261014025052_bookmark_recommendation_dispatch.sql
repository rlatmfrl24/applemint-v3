begin;
create function private.bookmark_dispatch_recommendation() returns trigger
language plpgsql set search_path='' as $$
begin
 perform public.dispatch_bookmark_worker();
 return new;
end $$;
revoke all on function private.bookmark_dispatch_recommendation() from public,anon,authenticated,service_role;
create trigger bookmark_recommendation_dispatch after insert or update of state on public.bookmark_jobs
for each row when (new.kind='recommend' and new.state='queued') execute function private.bookmark_dispatch_recommendation();

do $$
declare definition text; marker text := '''state'',''failed'',''failed'',1,''error''';
begin
 definition := pg_get_functiondef('public.bookmark_worker_commit(uuid,uuid,jsonb)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'recommendation invalidation changed'; end if;
 execute replace(definition,marker,'''state'',''failed'',''completed'',0,''failed'',1,''error''');
end $$;
commit;
