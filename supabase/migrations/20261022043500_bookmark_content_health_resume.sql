begin;
do $$ declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 marker:='update public.bookmark_job_items i set state=''pending'',error=null,expected_version=book.version from public.bookmarks book where i.job_id=j.id and i.bookmark_id=book.id and i.state=''failed'';';
 if position(marker in definition)=0 then raise exception 'bookmark health resume boundary changed'; end if;
 execute replace(definition,marker,$resume$
 update public.bookmark_job_items i set state='pending',error=null,expected_version=book.version,
  available_at=case when j.kind='check' then now() else i.available_at end,
  work=case when j.kind='check' and (i.expected_version<>book.version or i.work->'observation'->'input'->>'url' is distinct from book.url) then null else i.work end
 from public.bookmarks book where i.job_id=j.id and i.bookmark_id=book.id and
  (i.state='failed' or (j.kind='check' and i.state<>'done' and i.expected_version<>book.version));
 $resume$);
 definition:=pg_get_functiondef('public.bookmark_worker_commit(uuid,uuid,jsonb)'::regprocedure);
 marker:='do update set status=excluded.status,reason=excluded.reason';
 if position(marker in definition)=0 then raise exception 'bookmark health check version boundary changed'; end if;
 execute replace(definition,marker,'do update set bookmark_version=excluded.bookmark_version,checked_url=excluded.checked_url,status=excluded.status,reason=excluded.reason');
end $$;
commit;
