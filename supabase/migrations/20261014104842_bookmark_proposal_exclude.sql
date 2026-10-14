begin;
do $$
declare definition text; marker text := 'elsif p_action=''proposalApply'' then';
begin
 definition := pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'proposal command boundary changed'; end if;
 execute replace(definition,marker,$exclude$elsif p_action='proposalExclude' then
  if jsonb_typeof(p_input->'items') is distinct from 'array' then raise exception 'invalid exclusion items' using errcode='22023'; end if;
  if jsonb_array_length(p_input->'items') not between 1 and 2000
   or (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_input->'items'))<>jsonb_array_length(p_input->'items') then
   raise exception 'invalid exclusion items' using errcode='22023';
  end if;
  -- Use the same stable bookmark-before-proposal lock order as approval and worker commits.
  for v_proposal in select value from jsonb_array_elements(p_input->'items') order by (value->>'id')::uuid loop
   select * into b from public.bookmarks where id=(v_proposal->>'id')::uuid for update;
   if not found or b.state<>'library' or b.version<>coalesce((v_proposal->>'version')::int,0) then
    raise exception 'bookmark changed' using errcode='PT409';
   end if;
  end loop;
  update public.bookmark_proposals set state='excluded'
   where state='pending' and bookmark_id in (select (value->>'id')::uuid from jsonb_array_elements(p_input->'items'));
  get diagnostics v_count=row_count;
  return jsonb_build_object('applied',v_count);
 elsif p_action='proposalApply' then$exclude$);
end $$;
commit;
