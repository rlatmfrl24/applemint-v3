-- Business conflicts must not trigger PostgREST's serialization retry loop.
-- Recreate the two existing functions without changing their ownership, grants or guards.
do $$
declare
 target regprocedure;
begin
 foreach target in array array[
  'public.bookmark_command(text,jsonb)'::regprocedure,
  'public.bookmark_assert_collection(uuid)'::regprocedure
 ] loop
  execute replace(pg_get_functiondef(target), 'errcode=''40001''', 'errcode=''PT409''');
 end loop;
end $$;
