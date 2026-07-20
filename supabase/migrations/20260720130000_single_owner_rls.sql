create or replace function public.is_applemint_owner()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select auth.uid() = '480f5282-7933-4800-a970-d6bc8f05e8cb'::uuid;
$$;

revoke all on function public.is_applemint_owner() from public, anon, service_role;
grant execute on function public.is_applemint_owner() to authenticated;

drop policy if exists "Enable delete for authenticated users only" on public."new-threads";
drop policy if exists "Enable delete for authenticated users only" on public."quick-save";
drop policy if exists "Enable delete for authenticated users only" on public.trash;
drop policy if exists "Enable insert for anon users only" on public."crawl-history";
drop policy if exists "Enable insert for anon users only" on public."new-threads";
drop policy if exists "Enable insert for authenticated users only" on public."new-threads";
drop policy if exists "Enable insert for authenticated users only" on public."quick-save";
drop policy if exists "Enable insert for authenticated users only" on public.trash;
drop policy if exists "Enable read access for all users" on public."crawl-history";
drop policy if exists "Enable read access for all users" on public."filter-keyword";
drop policy if exists "Enable read access for all users" on public."new-threads";
drop policy if exists "Enable read access for all users" on public."quick-save";
drop policy if exists "Enable read access for all users" on public.trash;

drop policy if exists "Applemint owner can read new threads" on public."new-threads";
create policy "Applemint owner can read new threads"
	on public."new-threads"
	for select
	to authenticated
	using ((select public.is_applemint_owner()));

drop policy if exists "Applemint owner can read quick saves" on public."quick-save";
create policy "Applemint owner can read quick saves"
	on public."quick-save"
	for select
	to authenticated
	using ((select public.is_applemint_owner()));

drop policy if exists "Applemint owner can read trash" on public.trash;
create policy "Applemint owner can read trash"
	on public.trash
	for select
	to authenticated
	using ((select public.is_applemint_owner()));

revoke all on table
	public."crawl-history",
	public."filter-keyword",
	public."new-threads",
	public."quick-save",
	public.trash,
	public.crawl_run_locks
from public, anon, authenticated;

grant select on table
	public."new-threads",
	public."quick-save",
	public.trash
to authenticated;

grant all on table
	public."crawl-history",
	public."filter-keyword",
	public."new-threads",
	public."quick-save",
	public.trash,
	public.crawl_run_locks
to service_role;

revoke all on sequence
	public."crawl-history_id_seq",
	public."filter-keyword_id_seq",
	public."new-threads_id_seq",
	public."quick-save_id_seq",
	public.trash_id_seq
from public, anon, authenticated;

grant all on sequence
	public."crawl-history_id_seq",
	public."filter-keyword_id_seq",
	public."new-threads_id_seq",
	public."quick-save_id_seq",
	public.trash_id_seq
to service_role;

create or replace function public.move_thread(
	p_thread_id bigint,
	p_source text,
	p_destination text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_destination_id bigint;
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can move a thread.';
	end if;

	if p_source = 'new-threads' and p_destination = 'quick-save' then
		with moved as (
			delete from public."new-threads"
			where id = p_thread_id
			returning type, url, title, description, host, tag, sub_url, captured_at
		)
		insert into public."quick-save" (
			type, url, title, description, host, tag, sub_url, captured_at
		)
		select type, url, title, description, host, tag, sub_url, captured_at
		from moved
		returning id into v_destination_id;
	elsif p_source = 'new-threads' and p_destination = 'trash' then
		with moved as (
			delete from public."new-threads"
			where id = p_thread_id
			returning type, url, title, description, host, tag, sub_url, captured_at
		)
		insert into public.trash (
			type, url, title, description, host, tag, sub_url, captured_at
		)
		select type, url, title, description, host, tag, sub_url, captured_at
		from moved
		returning id into v_destination_id;
	elsif p_source = 'quick-save' and p_destination = 'trash' then
		with moved as (
			delete from public."quick-save"
			where id = p_thread_id
			returning type, url, title, description, host, tag, sub_url, captured_at
		)
		insert into public.trash (
			type, url, title, description, host, tag, sub_url, captured_at
		)
		select type, url, title, description, host, tag, sub_url, captured_at
		from moved
		returning id into v_destination_id;
	elsif p_source = 'trash' and p_destination = 'new-threads' then
		with moved as (
			delete from public.trash
			where id = p_thread_id
			returning type, url, title, description, host, tag, sub_url, captured_at
		)
		insert into public."new-threads" (
			type, url, title, description, host, tag, sub_url, captured_at
		)
		select type, url, title, description, host, tag, sub_url, captured_at
		from moved
		returning id into v_destination_id;
	else
		raise exception using
			errcode = '22023',
			message = format('Unsupported thread transition: %s -> %s', p_source, p_destination);
	end if;

	if v_destination_id is null then
		raise exception using
			errcode = 'P0002',
			message = format('Thread %s was not found in %s.', p_thread_id, p_source);
	end if;

	return v_destination_id;
end;
$$;

create or replace function public.bulk_move_new_threads_to_trash()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_moved_count bigint;
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can move threads.';
	end if;

	with moved as (
		delete from public."new-threads"
		returning type, url, title, description, host, tag, sub_url, captured_at
	)
	insert into public.trash (
		type, url, title, description, host, tag, sub_url, captured_at
	)
	select type, url, title, description, host, tag, sub_url, captured_at
	from moved;

	get diagnostics v_moved_count = row_count;
	return v_moved_count;
end;
$$;

create or replace function public.get_new_threads_stats(
	in_scope text default 'normal',
	in_filter_type text default null,
	in_issuelink_category text default null
)
returns table (
	key text,
	label text,
	count bigint,
	total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can read thread statistics.';
	end if;

	return query
	with filtered_rows as (
		select thread.type, thread.tag
		from public."new-threads" as thread
		where
			(
				in_scope <> 'normal'
				or (thread.type <> 'media' and thread.type <> 'youtube')
			)
			and (
				in_filter_type is null
				or (
					in_filter_type = 'issuelink'
					and thread.type = 'issuelink'
					and (
						in_issuelink_category is null
						or thread.tag[2] = in_issuelink_category
					)
				)
				or (
					in_filter_type <> 'issuelink'
					and thread.type = in_filter_type
				)
			)
	),
	grouped_rows as (
		select
			case
				when filtered_rows.type = 'issuelink'
					then 'issuelink::' || coalesce(filtered_rows.tag[2], 'unknown')
				else filtered_rows.type
			end as stat_key,
			case
				when filtered_rows.type = 'issuelink'
					then coalesce(filtered_rows.tag[2], 'unknown')
				else filtered_rows.type
			end as stat_label,
			count(*)::bigint as stat_count
		from filtered_rows
		group by 1, 2
	),
	total_rows as (
		select count(*)::bigint as stat_total_count
		from filtered_rows
	)
	select
		grouped_rows.stat_key,
		grouped_rows.stat_label,
		grouped_rows.stat_count,
		total_rows.stat_total_count
	from grouped_rows
	cross join total_rows
	order by grouped_rows.stat_count desc;
end;
$$;

revoke all on function public.move_thread(bigint, text, text) from public, anon, service_role;
grant execute on function public.move_thread(bigint, text, text) to authenticated;

revoke all on function public.bulk_move_new_threads_to_trash() from public, anon, service_role;
grant execute on function public.bulk_move_new_threads_to_trash() to authenticated;

revoke all on function public.get_new_threads_stats(text, text, text)
	from public, anon, service_role;
grant execute on function public.get_new_threads_stats(text, text, text) to authenticated;

revoke all on function public.clean_trash() from public, anon, authenticated;
grant execute on function public.clean_trash() to service_role;

alter default privileges for role postgres in schema public
	revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
	revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
	revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public
	revoke execute on functions from public;
