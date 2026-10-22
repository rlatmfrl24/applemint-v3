begin;
-- Keep long URL filters in request bodies instead of the REST request URI.
create function public.bookmark_lookup(p_url text)
returns table(id uuid,url text,title text,state text)
language sql stable security invoker set search_path='' as $$
 select b.id,b.url,b.title,b.state
 from public.bookmarks b where b.url_key=p_url
 order by b.state asc,b.updated_at desc,b.id asc limit 1;
$$;
revoke all on function public.bookmark_lookup(text) from public,anon,authenticated,service_role;
grant execute on function public.bookmark_lookup(text) to authenticated;
notify pgrst,'reload schema';
commit;
