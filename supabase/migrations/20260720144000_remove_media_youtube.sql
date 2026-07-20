delete from public."filter-keyword"
where method in ('media', 'youtube');

delete from public."new-threads"
where type in ('media', 'youtube');

delete from public."quick-save"
where type in ('media', 'youtube');

delete from public.trash
where type in ('media', 'youtube');

alter table public."filter-keyword"
	add constraint filter_keyword_no_removed_media_types
	check (method not in ('media', 'youtube'));

alter table public."new-threads"
	add constraint new_threads_no_removed_media_types
	check (type not in ('media', 'youtube'));

alter table public."quick-save"
	add constraint quick_save_no_removed_media_types
	check (type not in ('media', 'youtube'));

alter table public.trash
	add constraint trash_no_removed_media_types
	check (type not in ('media', 'youtube'));

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
			returning type, url, title, description, host, tag, captured_at
		)
		insert into public."quick-save" (
			type, url, title, description, host, tag, captured_at
		)
		select type, url, title, description, host, tag, captured_at
		from moved
		returning id into v_destination_id;
	elsif p_source = 'new-threads' and p_destination = 'trash' then
		with moved as (
			delete from public."new-threads"
			where id = p_thread_id
			returning type, url, title, description, host, tag, captured_at
		)
		insert into public.trash (
			type, url, title, description, host, tag, captured_at
		)
		select type, url, title, description, host, tag, captured_at
		from moved
		returning id into v_destination_id;
	elsif p_source = 'quick-save' and p_destination = 'trash' then
		with moved as (
			delete from public."quick-save"
			where id = p_thread_id
			returning type, url, title, description, host, tag, captured_at
		)
		insert into public.trash (
			type, url, title, description, host, tag, captured_at
		)
		select type, url, title, description, host, tag, captured_at
		from moved
		returning id into v_destination_id;
	elsif p_source = 'trash' and p_destination = 'new-threads' then
		with moved as (
			delete from public.trash
			where id = p_thread_id
			returning type, url, title, description, host, tag, captured_at
		)
		insert into public."new-threads" (
			type, url, title, description, host, tag, captured_at
		)
		select type, url, title, description, host, tag, captured_at
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
		returning type, url, title, description, host, tag, captured_at
	)
	insert into public.trash (
		type, url, title, description, host, tag, captured_at
	)
	select type, url, title, description, host, tag, captured_at
	from moved;

	get diagnostics v_moved_count = row_count;
	return v_moved_count;
end;
$$;

create or replace function public.ingest_crawl_items(
	p_crawl_source text,
	p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_result jsonb;
begin
	if p_crawl_source not in ('arcalive', 'battlepage', 'insagirl', 'issuelink') then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;

	if p_items is null or jsonb_typeof(p_items) <> 'array' then
		raise exception using errcode = '22023', message = 'Crawl items must be a JSON array.';
	end if;

	if jsonb_array_length(p_items) > 1000 then
		raise exception using errcode = '22023', message = 'A crawl batch cannot exceed 1000 items.';
	end if;

	with normalized_payload as materialized (
		select distinct on (btrim(item ->> 'url'))
			btrim(item ->> 'url') as url,
			nullif(item ->> 'title', '') as title,
			nullif(item ->> 'description', '') as description,
			nullif(item ->> 'host', '') as host,
			case
				when coalesce(nullif(item ->> 'type', ''), 'normal') in ('media', 'youtube')
					then 'normal'
				else coalesce(nullif(item ->> 'type', ''), 'normal')
			end as type,
			case
				when jsonb_typeof(item -> 'tag') = 'array' then
					array(select jsonb_array_elements_text(item -> 'tag'))
				else null
			end as tag
		from jsonb_array_elements(p_items) as payload(item)
		where nullif(btrim(item ->> 'url'), '') is not null
		order by btrim(item ->> 'url')
	),
	claimed as (
		insert into public."crawl-history" (url, crawl_source, host)
		select url, p_crawl_source, host
		from normalized_payload
		on conflict (crawl_source, url) do nothing
		returning url
	),
	inserted as (
		insert into public."new-threads" (
			url, title, description, host, type, tag
		)
		select
			payload.url,
			payload.title,
			payload.description,
			payload.host,
			payload.type,
			payload.tag
		from normalized_payload as payload
		inner join claimed using (url)
		returning url
	),
	counts as (
		select
			(select count(*) from normalized_payload) as input_count,
			(select count(*) from inserted) as inserted_count
	)
	select jsonb_build_object(
		'insertedCount', inserted_count,
		'skippedCount', input_count - inserted_count
	)
	into v_result
	from counts;

	return coalesce(v_result, jsonb_build_object('insertedCount', 0, 'skippedCount', 0));
end;
$$;

revoke all on function public.ingest_crawl_items(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_crawl_items(text, jsonb) to service_role;

revoke all on function public.get_new_threads_stats(text, text, text)
	from public, anon, authenticated, service_role;
drop function public.get_new_threads_stats(text, text, text);

create function public.get_new_threads_stats(
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

revoke all on function public.get_new_threads_stats(text, text)
	from public, anon, service_role;
grant execute on function public.get_new_threads_stats(text, text) to authenticated;

alter table public."new-threads" drop column if exists sub_url;
alter table public."quick-save" drop column if exists sub_url;
alter table public.trash drop column if exists sub_url;
