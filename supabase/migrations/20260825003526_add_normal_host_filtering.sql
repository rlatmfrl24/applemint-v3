create index idx_threads_state_type_host_changed_at_id
	on public.threads (state, type, host, state_changed_at desc, id desc);

create function public.get_normal_host_stats()
returns table (host text, count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can read normal host statistics.';
	end if;

	return query
	with normal_rows as materialized (
		select thread.host
		from public.threads as thread
		where thread.state = 'inbox'
			and thread.type = 'normal'
	),
	total_rows as (
		select count(*)::bigint as total_count
		from normal_rows
	),
	grouped_rows as (
		select normal_rows.host as normal_host, count(*)::bigint as host_count
		from normal_rows
		where nullif(btrim(normal_rows.host), '') is not null
		group by normal_rows.host
	)
	select grouped_rows.normal_host, grouped_rows.host_count
	from grouped_rows
	cross join total_rows
	where grouped_rows.host_count >= 10
		and grouped_rows.host_count * 5 >= total_rows.total_count
	order by grouped_rows.host_count desc, grouped_rows.normal_host asc
	limit 5;
end;
$$;

revoke all on function public.get_normal_host_stats()
	from public, anon, authenticated, service_role;
grant execute on function public.get_normal_host_stats()
	to authenticated;

drop function public.list_threads_page(
	text,
	integer,
	timestamp with time zone,
	bigint,
	text
);

create function public.list_threads_page(
	p_state text,
	p_limit integer default 24,
	p_cursor_state_changed_at timestamp with time zone default null,
	p_cursor_id bigint default null,
	p_filter_type text default null,
	p_filter_host text default null
)
returns table (
	id text,
	created_at timestamp with time zone,
	type text,
	url text,
	title text,
	description text,
	host text,
	tag text[],
	state text,
	captured_at timestamp with time zone,
	state_changed_at timestamp with time zone,
	media_metadata jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if not public.is_applemint_owner() then
		raise exception using errcode = '42501', message = 'Only the Applemint owner can list threads.';
	end if;
	if p_state is null or p_state not in ('inbox', 'saved', 'trash') then
		raise exception using errcode = '22023', message = format('Unsupported thread state: %s', p_state);
	end if;
	if p_limit is null or p_limit < 1 or p_limit > 100 then
		raise exception using errcode = '22023', message = 'Thread page limit must be between 1 and 100.';
	end if;
	if (p_cursor_state_changed_at is null) <> (p_cursor_id is null) then
		raise exception using errcode = '22023', message = 'Both cursor fields must be provided together.';
	end if;
	if p_cursor_id is not null and p_cursor_id <= 0 then
		raise exception using errcode = '22023', message = 'Thread cursor id must be positive.';
	end if;
	if p_filter_host is not null and (btrim(p_filter_host) = '' or length(p_filter_host) > 512) then
		raise exception using errcode = '22023', message = 'Thread host filter must contain 1 to 512 characters.';
	end if;
	if p_filter_host is not null and p_filter_type is distinct from 'normal' then
		raise exception using errcode = '22023', message = 'Thread host filters require the normal thread type.';
	end if;

	return query
	select
		thread.id::text,
		thread.created_at,
		thread.type,
		thread.url,
		thread.title,
		thread.description,
		thread.host,
		thread.tag,
		thread.state,
		thread.captured_at,
		thread.state_changed_at,
		case
			when metadata.thread_id is null then null
			else jsonb_build_object(
				'provider', metadata.provider,
				'external_id', metadata.external_id,
				'media_kind', metadata.media_kind,
				'status', metadata.status,
				'title', metadata.title,
				'channel_title', metadata.channel_title,
				'thumbnail_url', metadata.thumbnail_url,
				'duration_seconds', metadata.duration_seconds,
				'live_status', metadata.live_status,
				'last_error_code', metadata.last_error_code,
				'fetched_at', metadata.fetched_at,
				'updated_at', metadata.updated_at
			)
		end as media_metadata
	from public.threads as thread
	left join public.thread_media_metadata as metadata
		on metadata.thread_id = thread.id
	where thread.state = p_state
		and (
			p_cursor_state_changed_at is null
			or (thread.state_changed_at, thread.id) < (p_cursor_state_changed_at, p_cursor_id)
		)
		and (p_filter_type is null or thread.type = p_filter_type)
		and (
			p_filter_host is null
			or (thread.type = 'normal' and thread.host = p_filter_host)
		)
	order by thread.state_changed_at desc, thread.id desc
	limit (p_limit + 1);
end;
$$;

revoke all on function public.list_threads_page(
	text,
	integer,
	timestamp with time zone,
	bigint,
	text,
	text
) from public, anon, authenticated, service_role;
grant execute on function public.list_threads_page(
	text,
	integer,
	timestamp with time zone,
	bigint,
	text,
	text
) to authenticated;
