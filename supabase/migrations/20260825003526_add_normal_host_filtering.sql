drop function if exists public.list_threads_page(
	text,
	integer,
	timestamp with time zone,
	bigint,
	text,
	text
);
drop function if exists public.list_threads_page(
	text,
	integer,
	timestamp with time zone,
	bigint,
	text
);
drop function if exists public.get_thread_stats_with_normal_sites(text, text);
drop function if exists public.get_normal_host_stats();
drop function if exists public.get_normal_site_stats();
drop index if exists public.idx_threads_state_type_host_changed_at_id;
drop index if exists public.idx_threads_state_type_site_changed_at_id;
drop function if exists public.normalize_normal_site_key(text);

create function public.normalize_normal_site_key(p_host text)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
	v_hostname text;
begin
	v_hostname := pg_catalog.lower(pg_catalog.btrim(p_host));
	v_hostname := pg_catalog.regexp_replace(
		v_hostname,
		'^[a-z][a-z0-9+.-]*://',
		'',
		'i'
	);
	v_hostname := pg_catalog.split_part(v_hostname, '/', 1);
	v_hostname := pg_catalog.split_part(v_hostname, '?', 1);
	v_hostname := pg_catalog.split_part(v_hostname, '#', 1);
	v_hostname := pg_catalog.regexp_replace(v_hostname, '^[^@]*@', '');
	v_hostname := pg_catalog.regexp_replace(v_hostname, ':[0-9]+$', '');
	v_hostname := pg_catalog.regexp_replace(v_hostname, '\.$', '');
	v_hostname := pg_catalog.regexp_replace(v_hostname, '^www\.', '');

	if v_hostname = '' then
		return null;
	end if;

	if v_hostname = '82cook.com' or v_hostname like '%.82cook.com' then return '82cook.com'; end if;
	if v_hostname = 'bobaedream.co.kr' or v_hostname like '%.bobaedream.co.kr' then return 'bobaedream.co.kr'; end if;
	if v_hostname = 'clien.net' or v_hostname like '%.clien.net' then return 'clien.net'; end if;
	if v_hostname = 'etoland.co.kr' or v_hostname like '%.etoland.co.kr' then return 'etoland.co.kr'; end if;
	if v_hostname = 'fmkorea.com' or v_hostname like '%.fmkorea.com' then return 'fmkorea.com'; end if;
	if v_hostname = 'humoruniv.com' or v_hostname like '%.humoruniv.com' then return 'humoruniv.com'; end if;
	if v_hostname = 'instiz.net' or v_hostname like '%.instiz.net' then return 'instiz.net'; end if;
	if v_hostname = 'inven.co.kr' or v_hostname like '%.inven.co.kr' then return 'inven.co.kr'; end if;
	if v_hostname = 'mlbpark.com' or v_hostname like '%.mlbpark.com' then return 'mlbpark.com'; end if;
	if v_hostname = 'ppomppu.co.kr' or v_hostname like '%.ppomppu.co.kr' then return 'ppomppu.co.kr'; end if;
	if v_hostname = 'ruliweb.com' or v_hostname like '%.ruliweb.com' then return 'ruliweb.com'; end if;
	if v_hostname = 'slrclub.com' or v_hostname like '%.slrclub.com' then return 'slrclub.com'; end if;
	if v_hostname = 'theqoo.net' or v_hostname like '%.theqoo.net' then return 'theqoo.net'; end if;
	if v_hostname = 'todayhumor.co.kr' or v_hostname like '%.todayhumor.co.kr' then return 'todayhumor.co.kr'; end if;
	if v_hostname = 'ygosu.com' or v_hostname like '%.ygosu.com' then return 'ygosu.com'; end if;
	if v_hostname = 'battlepage.com' or v_hostname like '%.battlepage.com' then return 'battlepage.com'; end if;
	if v_hostname = 'arca.live' or v_hostname like '%.arca.live' then return 'arca.live'; end if;
	if v_hostname = 'issuelink.co.kr' or v_hostname like '%.issuelink.co.kr' then return 'issuelink.co.kr'; end if;

	return v_hostname;
end;
$$;

revoke all on function public.normalize_normal_site_key(text)
	from public, anon, authenticated, service_role;
grant execute on function public.normalize_normal_site_key(text)
	to authenticated, service_role;

create index idx_threads_state_type_site_changed_at_id
	on public.threads (
		state,
		type,
		public.normalize_normal_site_key(host),
		state_changed_at desc,
		id desc
	);

create function public.get_normal_site_stats()
returns table (site_key text, count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can read normal site statistics.';
	end if;

	return query
	with normal_rows as materialized (
		select public.normalize_normal_site_key(thread.host) as normalized_site_key
		from public.threads as thread
		where thread.state = 'inbox'
			and thread.type = 'normal'
	),
	total_rows as (
		select count(*)::bigint as total_count
		from normal_rows
	),
	grouped_rows as (
		select normal_rows.normalized_site_key, count(*)::bigint as site_count
		from normal_rows
		where normal_rows.normalized_site_key is not null
		group by normal_rows.normalized_site_key
	)
	select grouped_rows.normalized_site_key, grouped_rows.site_count
	from grouped_rows
	cross join total_rows
	where grouped_rows.site_count >= 10
		and grouped_rows.site_count * 5 >= total_rows.total_count
	order by grouped_rows.site_count desc, grouped_rows.normalized_site_key asc
	limit 5;
end;
$$;

revoke all on function public.get_normal_site_stats()
	from public, anon, authenticated, service_role;
grant execute on function public.get_normal_site_stats()
	to authenticated;

create function public.get_thread_stats_with_normal_sites(
	p_state text,
	p_filter_type text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_result jsonb;
begin
	if not public.is_applemint_owner() then
		raise exception using errcode = '42501', message = 'Only the Applemint owner can read thread statistics.';
	end if;
	if p_state is null or p_state not in ('inbox', 'saved', 'trash') then
		raise exception using errcode = '22023', message = format('Unsupported thread state: %s', p_state);
	end if;

	with type_stats as materialized (
		select *
		from public.get_thread_stats(p_state, p_filter_type)
	),
	site_stats as materialized (
		select *
		from public.get_normal_site_stats()
		where p_state = 'inbox'
			and (p_filter_type is null or p_filter_type = 'normal')
	)
	select pg_catalog.jsonb_build_object(
		'rows', coalesce(
			(
				select pg_catalog.jsonb_agg(
					pg_catalog.jsonb_build_object(
						'key', type_stats.key,
						'count', type_stats.count,
						'total_count', type_stats.total_count
					)
					order by type_stats.count desc, type_stats.key asc
				)
				from type_stats
			),
			'[]'::jsonb
		),
		'sites', coalesce(
			(
				select pg_catalog.jsonb_agg(
					pg_catalog.jsonb_build_object(
						'site_key', site_stats.site_key,
						'count', site_stats.count
					)
					order by site_stats.count desc, site_stats.site_key asc
				)
				from site_stats
			),
			'[]'::jsonb
		)
	)
	into v_result;

	return v_result;
end;
$$;

revoke all on function public.get_thread_stats_with_normal_sites(text, text)
	from public, anon, authenticated, service_role;
grant execute on function public.get_thread_stats_with_normal_sites(text, text)
	to authenticated;

create function public.list_threads_page(
	p_state text,
	p_limit integer default 24,
	p_cursor_state_changed_at timestamp with time zone default null,
	p_cursor_id bigint default null,
	p_filter_type text default null,
	p_filter_site text default null
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
declare
	v_excluded_sites text[] := array[]::text[];
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
	if p_filter_site is not null and (btrim(p_filter_site) = '' or length(p_filter_site) > 512) then
		raise exception using errcode = '22023', message = 'Thread site filter must contain 1 to 512 characters.';
	end if;
	if p_filter_site is not null and p_filter_type is distinct from 'normal' then
		raise exception using errcode = '22023', message = 'Thread site filters require the normal thread type.';
	end if;
	if p_filter_site is not null then
		p_filter_site := public.normalize_normal_site_key(p_filter_site);
	end if;
	if p_state = 'inbox' and p_filter_type = 'normal' and p_filter_site is null then
		select coalesce(pg_catalog.array_agg(site_stats.site_key), array[]::text[])
		into v_excluded_sites
		from public.get_normal_site_stats() as site_stats;
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
			p_filter_site is null
			or (
				thread.type = 'normal'
				and public.normalize_normal_site_key(thread.host) = p_filter_site
			)
		)
		and not coalesce(
			public.normalize_normal_site_key(thread.host) = any(v_excluded_sites),
			false
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
