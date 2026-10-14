create function private.bookmark_move_many(p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
 item jsonb; b public.bookmarks; target uuid; applied integer := 0;
begin
 if jsonb_typeof(p_input->'items') is distinct from 'array' then
  raise exception 'invalid move items' using errcode='22023';
 end if;
 if jsonb_array_length(p_input->'items') not between 1 and 2000
  or (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_input->'items')) <> jsonb_array_length(p_input->'items')
  or not (p_input ? 'collectionId') then
  raise exception 'invalid move items' using errcode='22023';
 end if;
 target := nullif(p_input->>'collectionId','')::uuid;
 perform public.bookmark_assert_collection(target);
 -- Lock the complete batch in stable order before checking or changing any member.
 for item in select value from jsonb_array_elements(p_input->'items') order by (value->>'id')::uuid loop
  select * into b from public.bookmarks where id=(item->>'id')::uuid for update;
  if not found then raise exception 'bookmark not found' using errcode='P0002'; end if;
  if b.state<>'library' or b.version<>coalesce((item->>'version')::int,0) then
   raise exception 'bookmark changed' using errcode='PT409';
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p_input->'items') order by (value->>'id')::uuid loop
  if (select collection_id from public.bookmarks where id=(item->>'id')::uuid) is distinct from target then
   perform public.bookmark_command('move', item || jsonb_build_object('collectionId',target));
   applied := applied + 1;
  end if;
 end loop;
 return jsonb_build_object('applied',applied);
end $$;
revoke all on function private.bookmark_move_many(jsonb) from public,anon,authenticated;

create function private.bookmark_reparent(p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
 c public.bookmark_collections; target uuid;
begin
 if not (p_input ? 'parentId') then raise exception 'invalid parent' using errcode='22023'; end if;
 target := nullif(p_input->>'parentId','')::uuid;
 perform public.bookmark_assert_collection(target);
 select * into c from public.bookmark_collections where id=(p_input->>'id')::uuid and archived_at is null for update;
 if not found or c.version<>coalesce((p_input->>'version')::int,0) then
  raise exception 'collection changed' using errcode='PT409';
 end if;
 if exists(
  with recursive descendants as (
   select c.id as id
   union
   select child.id from public.bookmark_collections child join descendants d on child.parent_id=d.id where child.archived_at is null
  ) select 1 from descendants where id=target
 ) then raise exception 'collection cycle' using errcode='22023'; end if;
 if c.parent_id is distinct from target then
  update public.bookmark_collections set parent_id=target,version=version+1 where id=c.id returning * into c;
 end if;
 return to_jsonb(c);
end $$;
revoke all on function private.bookmark_reparent(jsonb) from public,anon,authenticated;

-- Extend the existing owner boundary and keep its grants and all current command behavior.
do $$
declare definition text;
begin
 definition := pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 if position('if p_action=''collectionRemove'' then' in definition)=0
  or position('if p_action=''save'' then' in definition)=0 then
  raise exception 'bookmark command dispatch changed';
 end if;
 definition := replace(definition,'if p_action=''collectionRemove'' then','if p_action in (''collectionRemove'',''collectionMove'') then');
 definition := replace(definition,'if p_action=''save'' then',
  'if p_action=''bulkMove'' then return private.bookmark_move_many(p_input);
 elsif p_action=''collectionMove'' then return private.bookmark_reparent(p_input);
 elsif p_action=''save'' then');
 execute definition;
end $$;
