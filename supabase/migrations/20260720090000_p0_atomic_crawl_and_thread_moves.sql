alter table public."new-threads"
	add column if not exists captured_at timestamp with time zone;

alter table public."quick-save"
	add column if not exists tag text[],
	add column if not exists sub_url text[],
	add column if not exists captured_at timestamp with time zone;

alter table public.trash
	add column if not exists tag text[],
	add column if not exists sub_url text[],
	add column if not exists captured_at timestamp with time zone;

update public."new-threads"
set captured_at = created_at
where captured_at is null;

update public."quick-save"
set captured_at = created_at
where captured_at is null;

update public.trash
set captured_at = created_at
where captured_at is null;

alter table public."new-threads"
	alter column captured_at set default now(),
	alter column captured_at set not null;

alter table public."quick-save"
	alter column captured_at set default now(),
	alter column captured_at set not null;

alter table public.trash
	alter column captured_at set default now(),
	alter column captured_at set not null;

create unique index if not exists idx_crawl_history_source_url_unique
	on public."crawl-history" (crawl_source, url);

create or replace function public.move_thread(
	p_thread_id bigint,
	p_source text,
	p_destination text
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_destination_id bigint;
begin
	if auth.uid() is null then
		raise exception using
			errcode = '42501',
			message = 'Authentication is required to move a thread.';
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

revoke all on function public.move_thread(bigint, text, text) from public, anon, service_role;
grant execute on function public.move_thread(bigint, text, text) to authenticated;

create or replace function public.bulk_move_new_threads_to_trash()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_moved_count bigint;
begin
	if auth.uid() is null then
		raise exception using
			errcode = '42501',
			message = 'Authentication is required to move threads.';
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

revoke all on function public.bulk_move_new_threads_to_trash() from public, anon, service_role;
grant execute on function public.bulk_move_new_threads_to_trash() to authenticated;

create table if not exists public.crawl_run_locks (
	lock_key text primary key,
	lock_token uuid not null,
	locked_until timestamp with time zone not null,
	updated_at timestamp with time zone not null default now()
);

alter table public.crawl_run_locks enable row level security;
revoke all on table public.crawl_run_locks from public, anon, authenticated;
grant all on table public.crawl_run_locks to service_role;

create or replace function public.acquire_crawl_lock(
	p_lock_key text,
	p_lock_token uuid,
	p_ttl_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_acquired boolean;
begin
	if p_lock_key is null or btrim(p_lock_key) = '' then
		raise exception using errcode = '22023', message = 'A crawl lock key is required.';
	end if;

	if p_ttl_seconds < 30 or p_ttl_seconds > 900 then
		raise exception using errcode = '22023', message = 'Crawl lock TTL must be between 30 and 900 seconds.';
	end if;

	insert into public.crawl_run_locks (lock_key, lock_token, locked_until, updated_at)
	values (
		p_lock_key,
		p_lock_token,
		now() + make_interval(secs => p_ttl_seconds),
		now()
	)
	on conflict (lock_key) do update
	set
		lock_token = excluded.lock_token,
		locked_until = excluded.locked_until,
		updated_at = excluded.updated_at
	where public.crawl_run_locks.locked_until <= now()
	returning true into v_acquired;

	return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_crawl_lock(
	p_lock_key text,
	p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_released boolean;
begin
	delete from public.crawl_run_locks
	where lock_key = p_lock_key
		and lock_token = p_lock_token
	returning true into v_released;

	return coalesce(v_released, false);
end;
$$;

revoke all on function public.acquire_crawl_lock(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_crawl_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_crawl_lock(text, uuid, integer) to service_role;
grant execute on function public.release_crawl_lock(text, uuid) to service_role;

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
			coalesce(nullif(item ->> 'type', ''), 'normal') as type,
			case
				when jsonb_typeof(item -> 'tag') = 'array' then
					array(select jsonb_array_elements_text(item -> 'tag'))
				else null
			end as tag,
			case
				when jsonb_typeof(item -> 'sub_url') = 'array' then
					array(select jsonb_array_elements_text(item -> 'sub_url'))
				else null
			end as sub_url
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
			url, title, description, host, type, sub_url, tag
		)
		select
			payload.url,
			payload.title,
			payload.description,
			payload.host,
			payload.type,
			payload.sub_url,
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
