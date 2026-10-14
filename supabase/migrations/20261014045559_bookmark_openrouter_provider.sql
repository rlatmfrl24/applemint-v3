begin;
do $$
declare definition text; marker text := '''provider'',''jev''';
begin
 definition := pg_get_functiondef('private.bookmark_start_recommendation(jsonb)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'recommendation gateway boundary changed'; end if;
 execute replace(definition,marker,'''provider'',''openrouter''');
end $$;
commit;
