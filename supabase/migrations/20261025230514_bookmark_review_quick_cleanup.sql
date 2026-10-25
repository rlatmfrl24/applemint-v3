begin;
do $$ declare definition text; marker text;
begin
 definition:=pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 marker:='where bookmark_id=b.id and kind=''review'' and state=''pending'';';
 if position(marker in definition)=0 then raise exception 'bookmark keep proposal boundary changed'; end if;
 -- Keeping current content dismisses existing suggestions without applying them.
 definition:=replace(definition,marker,'where bookmark_id=b.id and state=''pending'';');
 execute definition;
end $$;
commit;
