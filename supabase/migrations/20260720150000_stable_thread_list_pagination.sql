create index if not exists idx_quick_save_created_at_id
	on public."quick-save" (created_at desc, id desc);

create index if not exists idx_trash_created_at_id
	on public.trash (created_at desc, id desc);

create or replace function public.list_thread_page(
	p_list text,
	p_limit integer default 24,
	p_cursor_created_at timestamp with time zone default null,
	p_cursor_id bigint default null,
	p_filter_type text default null,
	p_issuelink_category text default null
)
returns table (
	id bigint,
	created_at timestamp with time zone,
	type text,
	url text,
	title text,
	description text,
	host text,
	tag text[],
	captured_at timestamp with time zone
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
			message = 'Only the Applemint owner can list threads.';
	end if;

	if p_list is null or p_list not in ('new-threads', 'quick-save', 'trash') then
		raise exception using
			errcode = '22023',
			message = format('Unsupported thread list: %s', p_list);
	end if;

	if p_limit is null or p_limit < 1 or p_limit > 100 then
		raise exception using
			errcode = '22023',
			message = 'Thread page limit must be between 1 and 100.';
	end if;

	if (p_cursor_created_at is null) <> (p_cursor_id is null) then
		raise exception using
			errcode = '22023',
			message = 'Both cursor fields must be provided together.';
	end if;

	if p_cursor_id is not null and p_cursor_id <= 0 then
		raise exception using
			errcode = '22023',
			message = 'Thread cursor id must be positive.';
	end if;

	if p_list = 'new-threads' then
		return query
		select
			thread.id,
			thread.created_at,
			thread.type,
			thread.url,
			thread.title,
			thread.description,
			thread.host,
			thread.tag,
			thread.captured_at
		from public."new-threads" as thread
		where
			(
				p_cursor_created_at is null
				or (thread.created_at, thread.id) < (p_cursor_created_at, p_cursor_id)
			)
			and (p_filter_type is null or thread.type = p_filter_type)
			and (
				p_issuelink_category is null
				or (thread.type = 'issuelink' and thread.tag[2] = p_issuelink_category)
			)
		order by thread.created_at desc, thread.id desc
		limit (p_limit + 1);
	elsif p_list = 'quick-save' then
		return query
		select
			thread.id,
			thread.created_at,
			thread.type,
			thread.url,
			thread.title,
			thread.description,
			thread.host,
			thread.tag,
			thread.captured_at
		from public."quick-save" as thread
		where
			(
				p_cursor_created_at is null
				or (thread.created_at, thread.id) < (p_cursor_created_at, p_cursor_id)
			)
			and (p_filter_type is null or thread.type = p_filter_type)
			and (
				p_issuelink_category is null
				or (thread.type = 'issuelink' and thread.tag[2] = p_issuelink_category)
			)
		order by thread.created_at desc, thread.id desc
		limit (p_limit + 1);
	else
		return query
		select
			thread.id,
			thread.created_at,
			thread.type,
			thread.url,
			thread.title,
			thread.description,
			thread.host,
			thread.tag,
			thread.captured_at
		from public.trash as thread
		where
			(
				p_cursor_created_at is null
				or (thread.created_at, thread.id) < (p_cursor_created_at, p_cursor_id)
			)
			and (p_filter_type is null or thread.type = p_filter_type)
			and (
				p_issuelink_category is null
				or (thread.type = 'issuelink' and thread.tag[2] = p_issuelink_category)
			)
		order by thread.created_at desc, thread.id desc
		limit (p_limit + 1);
	end if;
end;
$$;

revoke all on function public.list_thread_page(text, integer, timestamp with time zone, bigint, text, text)
	from public, anon, service_role;
grant execute on function public.list_thread_page(text, integer, timestamp with time zone, bigint, text, text)
	to authenticated;
