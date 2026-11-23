begin;
-- Read a page of exact URL keys in one request body, including long links.
create function public.bookmark_saved_url_keys(p_url_keys text[])
returns text[]
language sql stable security invoker set search_path='' as $$
 select array(
  select distinct requested.url_key
  from unnest(p_url_keys) as requested(url_key)
  where cardinality(p_url_keys) <= 100
    and exists (
     select 1 from public.bookmarks b
     where b.url_key=requested.url_key and b.state='library'
    )
  order by requested.url_key
 );
$$;
revoke all on function public.bookmark_saved_url_keys(text[]) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_saved_url_keys(text[]) to authenticated;
notify pgrst,'reload schema';
commit;
