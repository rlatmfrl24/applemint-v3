begin;
alter table public.bookmark_collections add column sort_order bigint;
with ranked as (
 select id,row_number() over(order by name,id) as position from public.bookmark_collections
) update public.bookmark_collections c set sort_order=r.position from ranked r where c.id=r.id;
create sequence public.bookmark_collection_order_seq;
select setval('public.bookmark_collection_order_seq',greatest(coalesce(max(sort_order),0),1),count(*)>0) from public.bookmark_collections;
alter table public.bookmark_collections alter column sort_order set default nextval('public.bookmark_collection_order_seq');
alter table public.bookmark_collections alter column sort_order set not null;
alter sequence public.bookmark_collection_order_seq owned by public.bookmark_collections.sort_order;
revoke all on sequence public.bookmark_collection_order_seq from public,anon,authenticated,service_role;
create index bookmark_collections_order_idx on public.bookmark_collections(parent_id,sort_order,id) where archived_at is null;

-- Creation and parent changes append without racing on max(position) or overwriting sibling order.
create function private.bookmark_append_collection() returns trigger language plpgsql set search_path='' as $$
begin
 new.sort_order := nextval('public.bookmark_collection_order_seq');
 return new;
end $$;
revoke all on function private.bookmark_append_collection() from public,anon,authenticated,service_role;
create trigger bookmark_collection_append before update of parent_id on public.bookmark_collections
for each row when (old.parent_id is distinct from new.parent_id) execute function private.bookmark_append_collection();

create function private.bookmark_reorder(p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
 c public.bookmark_collections; target public.bookmark_collections;
 previous uuid[]; desired uuid[]; insertion integer;
begin
 if coalesce(p_input->>'position','') not in ('before','after') then
  raise exception 'invalid reorder position' using errcode='22023';
 end if;
 if (p_input->>'id')::uuid=(p_input->>'targetId')::uuid then
  raise exception 'invalid reorder target' using errcode='22023';
 end if;
 perform public.bookmark_assert_collection((p_input->>'id')::uuid);
 perform public.bookmark_assert_collection((p_input->>'targetId')::uuid);
 select * into c from public.bookmark_collections where id=(p_input->>'id')::uuid;
 select * into target from public.bookmark_collections where id=(p_input->>'targetId')::uuid;
 if c.id is null or target.id is null or c.version<>coalesce((p_input->>'version')::int,0)
  or target.version<>coalesce((p_input->>'targetVersion')::int,0) then
  raise exception 'collection changed' using errcode='PT409';
 end if;
 if c.parent_id is distinct from target.parent_id then
  raise exception 'collections must be siblings' using errcode='22023';
 end if;
 perform id from public.bookmark_collections
 where parent_id is not distinct from c.parent_id and archived_at is null and source_id is distinct from '-1'
 order by id for update;
 select array_agg(id order by sort_order,id) into previous from public.bookmark_collections
 where parent_id is not distinct from c.parent_id and archived_at is null and source_id is distinct from '-1';
 desired := array_remove(previous,c.id);
 insertion := array_position(desired,target.id) + case when p_input->>'position'='after' then 1 else 0 end;
 desired := coalesce(desired[1:insertion-1],'{}'::uuid[]) || array[c.id] || coalesce(desired[insertion:array_length(desired,1)],'{}'::uuid[]);
 if previous is distinct from desired then
  update public.bookmark_collections sibling set sort_order=ordered.position,version=sibling.version+1
  from unnest(desired) with ordinality as ordered(id,position) where sibling.id=ordered.id;
  select * into c from public.bookmark_collections where id=c.id;
 end if;
 return to_jsonb(c);
end $$;
revoke all on function private.bookmark_reorder(jsonb) from public,anon,authenticated,service_role;

do $$
declare definition text;
begin
 definition := pg_get_functiondef('public.bookmark_command(text,jsonb)'::regprocedure);
 if position('if p_action in (''collectionRemove'',''collectionMove'') then' in definition)=0
  or position('if p_action=''bulkMove'' then' in definition)=0 then
  raise exception 'bookmark command dispatch changed';
 end if;
 definition := replace(definition,'if p_action in (''collectionRemove'',''collectionMove'') then',
  'if p_action in (''collectionRemove'',''collectionMove'',''collectionReorder'') then');
 definition := replace(definition,'if p_action=''bulkMove'' then',
  'if p_action=''collectionReorder'' then return private.bookmark_reorder(p_input);
 elsif p_action=''bulkMove'' then');
 execute definition;
 definition := pg_get_functiondef('public.bookmark_snapshot(jsonb)'::regprocedure);
 if position('order by c.name,c.id' in definition)=0 then raise exception 'bookmark snapshot order changed'; end if;
 execute replace(definition,'order by c.name,c.id','order by c.sort_order,c.id');
end $$;
commit;
