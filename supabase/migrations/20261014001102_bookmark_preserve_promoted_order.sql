begin;
do $$
declare definition text; previous text := 'update public.bookmark_collections set parent_id=c.parent_id,version=version+1 where parent_id=c.id and archived_at is null;
  get diagnostics v_children=row_count;';
begin
 definition := pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 if position(previous in definition)=0 then raise exception 'bookmark child promotion changed'; end if;
 execute replace(definition,previous,
  'v_children := 0;
  for v_target in select child.id from public.bookmark_collections child where child.parent_id=c.id and child.archived_at is null order by child.sort_order,child.id loop
   update public.bookmark_collections set parent_id=c.parent_id,version=version+1 where id=v_target;
   v_children := v_children + 1;
  end loop;');
end $$;
commit;
