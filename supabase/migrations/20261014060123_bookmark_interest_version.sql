begin;
do $$
declare definition text; marker text := 'if p_action=''interests'' then';
begin
 definition := pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'interest command boundary changed'; end if;
 execute replace(definition,marker,$guard$if p_action='interests' then
  perform 1 from public.bookmark_settings where id for update;
  if p_input ? 'version' and (p_input->>'version')::int is distinct from (select interest_version from public.bookmark_settings where id) then
   raise exception 'interests changed' using errcode='PT409';
  end if;$guard$);
end $$;
commit;
