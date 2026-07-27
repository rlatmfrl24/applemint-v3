begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
	p_filter_type text default null
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
				'media_count', metadata.media_count,
				'preview_urls', metadata.preview_urls,
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
	order by thread.state_changed_at desc, thread.id desc
	limit (p_limit + 1);
end;
$$;

revoke all on function public.list_threads_page(text, integer, timestamp with time zone, bigint, text)
	from public, anon, authenticated, service_role;
grant execute on function public.list_threads_page(text, integer, timestamp with time zone, bigint, text)
	to authenticated;

drop function public.transition_thread_state(bigint, text, text);

create function public.transition_thread_state(
	p_thread_id bigint,
	p_expected_state text,
	p_destination_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_thread public.threads;
begin
	if not public.is_applemint_owner() then
		raise exception using errcode = '42501', message = 'Only the Applemint owner can move a thread.';
	end if;
	if p_thread_id is null or p_thread_id <= 0 then
		raise exception using errcode = '22023', message = 'Thread ID must be positive.';
	end if;
	if (p_expected_state, p_destination_state) not in (
		('inbox', 'saved'),
		('inbox', 'trash'),
		('saved', 'trash'),
		('trash', 'inbox')
	) then
		raise exception using
			errcode = '22023',
			message = format(
				'Unsupported thread transition: %s -> %s',
				p_expected_state,
				p_destination_state
			);
	end if;

	update public.threads
	set state = p_destination_state
	where id = p_thread_id and state = p_expected_state
	returning * into v_thread;

	if found then
		return to_jsonb(v_thread) || jsonb_build_object('id', v_thread.id::text);
	end if;

	select * into v_thread from public.threads where id = p_thread_id;
	if not found then
		raise exception using
			errcode = 'P0002',
			message = format('Thread %s was not found.', p_thread_id);
	end if;
	if v_thread.state = p_destination_state then
		return to_jsonb(v_thread) || jsonb_build_object('id', v_thread.id::text);
	end if;

	raise exception using
		errcode = '40001',
		message = format(
			'Thread %s is in state %s instead of expected state %s.',
			p_thread_id,
			v_thread.state,
			p_expected_state
		);
end;
$$;

revoke all on function public.transition_thread_state(bigint, text, text)
	from public, anon, authenticated, service_role;
grant execute on function public.transition_thread_state(bigint, text, text) to authenticated;

commit;
