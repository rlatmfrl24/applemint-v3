begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.thread_media_metadata (
	thread_id bigint primary key
		references public.threads(id) on delete cascade,
	provider text not null,
	external_id text,
	media_kind text,
	status text not null default 'pending',
	title text,
	channel_title text,
	thumbnail_url text,
	duration_seconds integer,
	live_status text,
	media_count integer,
	preview_urls text[] not null default array[]::text[],
	last_error_code text,
	fetched_at timestamp with time zone,
	created_at timestamp with time zone not null default now(),
	updated_at timestamp with time zone not null default now(),
	constraint thread_media_metadata_provider_check
		check (provider in ('youtube', 'imgur')),
	constraint thread_media_metadata_status_check
		check (status in ('pending', 'ready', 'unavailable', 'unsupported', 'failed')),
	constraint thread_media_metadata_media_kind_check
		check (
			media_kind is null
			or media_kind in ('video', 'short', 'live', 'image', 'album', 'gallery', 'unsupported')
		),
	constraint thread_media_metadata_duration_check
		check (duration_seconds is null or duration_seconds >= 0),
	constraint thread_media_metadata_live_status_check
		check (live_status is null or live_status in ('none', 'live', 'upcoming')),
	constraint thread_media_metadata_media_count_check
		check (media_count is null or media_count >= 0),
	constraint thread_media_metadata_preview_count_check
		check (cardinality(preview_urls) <= 4),
	constraint thread_media_metadata_error_code_check
		check (last_error_code is null or char_length(last_error_code) between 1 and 128)
);

comment on table public.thread_media_metadata is
	'Normalized YouTube and Imgur metadata summaries. Raw provider API payloads are not stored.';

create table public.media_enrichment_jobs (
	thread_id bigint primary key
		references public.thread_media_metadata(thread_id) on delete cascade,
	provider text not null,
	state text not null default 'queued',
	attempt_count integer not null default 0,
	available_at timestamp with time zone not null default now(),
	lease_token uuid,
	lease_expires_at timestamp with time zone,
	last_error_code text,
	created_at timestamp with time zone not null default now(),
	updated_at timestamp with time zone not null default now(),
	constraint media_enrichment_jobs_provider_check
		check (provider in ('youtube', 'imgur')),
	constraint media_enrichment_jobs_state_check
		check (state in ('queued', 'processing', 'retry', 'succeeded', 'dead')),
	constraint media_enrichment_jobs_attempt_count_check
		check (attempt_count >= 0),
	constraint media_enrichment_jobs_lease_check
		check (
			(
				state = 'processing'
				and lease_token is not null
				and lease_expires_at is not null
			)
			or (
				state <> 'processing'
				and lease_token is null
				and lease_expires_at is null
			)
		),
	constraint media_enrichment_jobs_error_code_check
		check (last_error_code is null or char_length(last_error_code) between 1 and 128)
);

comment on table public.media_enrichment_jobs is
	'Service-role-only durable queue for YouTube and Imgur metadata enrichment.';

create index media_enrichment_jobs_available_idx
	on public.media_enrichment_jobs (provider, available_at, created_at, thread_id)
	include (attempt_count)
	where state in ('queued', 'retry');

create index media_enrichment_jobs_expired_lease_idx
	on public.media_enrichment_jobs (provider, lease_expires_at, created_at, thread_id)
	include (attempt_count)
	where state = 'processing';

alter table public.thread_media_metadata enable row level security;
alter table public.media_enrichment_jobs enable row level security;

create policy "Applemint owner can read media metadata"
	on public.thread_media_metadata
	for select
	to authenticated
	using ((select public.is_applemint_owner()));

revoke all on table public.thread_media_metadata
	from public, anon, authenticated, service_role;
grant select on table public.thread_media_metadata to authenticated;
grant select, insert, update, delete on table public.thread_media_metadata to service_role;

revoke all on table public.media_enrichment_jobs
	from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.media_enrichment_jobs to service_role;

create function public.claim_media_enrichment_jobs(
	p_provider text,
	p_limit integer,
	p_lease_seconds integer
)
returns table (
	thread_id bigint,
	provider text,
	url text,
	attempt_count integer,
	lease_token uuid,
	lease_expires_at timestamp with time zone
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
begin
	if p_provider is null or p_provider not in ('youtube', 'imgur') then
		raise exception using errcode = '22023', message = 'Unsupported media provider.';
	end if;
	if p_limit is null or p_limit < 1 or p_limit > 100 then
		raise exception using errcode = '22023', message = 'Claim limit must be between 1 and 100.';
	end if;
	if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
		raise exception using errcode = '22023', message = 'Lease duration must be between 1 and 3600 seconds.';
	end if;

	return query
	with candidates as materialized (
		select job.thread_id
		from public.media_enrichment_jobs as job
		where job.provider = p_provider
			and (
				(
					job.state in ('queued', 'retry')
					and job.available_at <= v_now
				)
				or (
					job.state = 'processing'
					and job.lease_expires_at <= v_now
				)
			)
		order by
			case
				when job.state = 'processing' then job.lease_expires_at
				else job.available_at
			end,
			job.created_at,
			job.thread_id
		for update skip locked
		limit p_limit
	),
	claimed as (
		update public.media_enrichment_jobs as job
		set
			state = 'processing',
			attempt_count = job.attempt_count + 1,
			lease_token = gen_random_uuid(),
			lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
			last_error_code = null,
			updated_at = v_now
		from candidates
		where job.thread_id = candidates.thread_id
		returning
			job.thread_id,
			job.provider,
			job.attempt_count,
			job.lease_token,
			job.lease_expires_at
	)
	select
		claimed.thread_id,
		claimed.provider,
		thread.url,
		claimed.attempt_count,
		claimed.lease_token,
		claimed.lease_expires_at
	from claimed
	inner join public.threads as thread on thread.id = claimed.thread_id
	order by claimed.thread_id;
end;
$$;

create function public.complete_media_enrichment_job(
	p_thread_id bigint,
	p_lease_token uuid,
	p_metadata jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
	v_provider text;
	v_status text;
	v_preview_urls text[] := array[]::text[];
begin
	if p_thread_id is null or p_thread_id <= 0 or p_lease_token is null then
		raise exception using errcode = '22023', message = 'Thread ID and lease token are required.';
	end if;
	if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
		raise exception using errcode = '22023', message = 'Normalized media metadata must be a JSON object.';
	end if;

	v_status := nullif(btrim(p_metadata ->> 'status'), '');
	if v_status is null or v_status not in ('ready', 'unavailable', 'unsupported') then
		raise exception using errcode = '22023', message = 'Completed metadata must use a terminal success status.';
	end if;

	if p_metadata ? 'preview_urls'
		and p_metadata -> 'preview_urls' <> 'null'::jsonb
	then
		if jsonb_typeof(p_metadata -> 'preview_urls') <> 'array'
			or exists (
				select 1
				from jsonb_array_elements(p_metadata -> 'preview_urls') as preview(value)
				where jsonb_typeof(preview.value) <> 'string'
			)
		then
			raise exception using errcode = '22023', message = 'preview_urls must be an array of strings.';
		end if;

		select coalesce(
			array_agg(preview.value order by preview.ordinality),
			array[]::text[]
		)
		into v_preview_urls
		from jsonb_array_elements_text(p_metadata -> 'preview_urls')
			with ordinality as preview(value, ordinality);
	end if;

	select job.provider
	into v_provider
	from public.media_enrichment_jobs as job
	where job.thread_id = p_thread_id
		and job.state = 'processing'
		and job.lease_token = p_lease_token
		and job.lease_expires_at > v_now
	for update;

	if not found then
		return false;
	end if;

	update public.thread_media_metadata
	set
		external_id = nullif(p_metadata ->> 'external_id', ''),
		media_kind = nullif(p_metadata ->> 'media_kind', ''),
		status = v_status,
		title = nullif(p_metadata ->> 'title', ''),
		channel_title = nullif(p_metadata ->> 'channel_title', ''),
		thumbnail_url = nullif(p_metadata ->> 'thumbnail_url', ''),
		duration_seconds = (nullif(p_metadata ->> 'duration_seconds', ''))::integer,
		live_status = nullif(p_metadata ->> 'live_status', ''),
		media_count = (nullif(p_metadata ->> 'media_count', ''))::integer,
		preview_urls = v_preview_urls,
		last_error_code = nullif(btrim(p_metadata ->> 'last_error_code'), ''),
		fetched_at = coalesce(
			(nullif(p_metadata ->> 'fetched_at', ''))::timestamp with time zone,
			v_now
		),
		updated_at = v_now
	where thread_id = p_thread_id
		and provider = v_provider;

	if not found then
		raise exception using
			errcode = 'P0002',
			message = 'Media metadata row was not found for the claimed job.';
	end if;

	update public.media_enrichment_jobs
	set
		state = 'succeeded',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = null,
		updated_at = v_now
	where thread_id = p_thread_id
		and state = 'processing'
		and lease_token = p_lease_token;

	return found;
end;
$$;

create function public.retry_media_enrichment_job(
	p_thread_id bigint,
	p_lease_token uuid,
	p_error_code text,
	p_available_at timestamp with time zone
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
	v_error_code text := nullif(btrim(p_error_code), '');
begin
	if p_thread_id is null or p_thread_id <= 0 or p_lease_token is null then
		raise exception using errcode = '22023', message = 'Thread ID and lease token are required.';
	end if;
	if v_error_code is null or char_length(v_error_code) > 128 or p_available_at is null then
		raise exception using errcode = '22023', message = 'A safe error code and retry time are required.';
	end if;

	perform 1
	from public.media_enrichment_jobs as job
	where job.thread_id = p_thread_id
		and job.state = 'processing'
		and job.lease_token = p_lease_token
		and job.lease_expires_at > v_now
	for update;

	if not found then
		return false;
	end if;

	update public.thread_media_metadata
	set
		status = 'pending',
		last_error_code = v_error_code,
		updated_at = v_now
	where thread_id = p_thread_id;

	update public.media_enrichment_jobs
	set
		state = 'retry',
		available_at = p_available_at,
		lease_token = null,
		lease_expires_at = null,
		last_error_code = v_error_code,
		updated_at = v_now
	where thread_id = p_thread_id
		and state = 'processing'
		and lease_token = p_lease_token;

	return found;
end;
$$;

create function public.fail_media_enrichment_job(
	p_thread_id bigint,
	p_lease_token uuid,
	p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
	v_error_code text := nullif(btrim(p_error_code), '');
begin
	if p_thread_id is null or p_thread_id <= 0 or p_lease_token is null then
		raise exception using errcode = '22023', message = 'Thread ID and lease token are required.';
	end if;
	if v_error_code is null or char_length(v_error_code) > 128 then
		raise exception using errcode = '22023', message = 'A safe error code is required.';
	end if;

	perform 1
	from public.media_enrichment_jobs as job
	where job.thread_id = p_thread_id
		and job.state = 'processing'
		and job.lease_token = p_lease_token
		and job.lease_expires_at > v_now
	for update;

	if not found then
		return false;
	end if;

	update public.thread_media_metadata
	set
		status = 'failed',
		last_error_code = v_error_code,
		fetched_at = v_now,
		updated_at = v_now
	where thread_id = p_thread_id;

	update public.media_enrichment_jobs
	set
		state = 'dead',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = v_error_code,
		updated_at = v_now
	where thread_id = p_thread_id
		and state = 'processing'
		and lease_token = p_lease_token;

	return found;
end;
$$;

revoke all on function public.claim_media_enrichment_jobs(text, integer, integer)
	from public, anon, authenticated;
revoke all on function public.complete_media_enrichment_job(bigint, uuid, jsonb)
	from public, anon, authenticated;
revoke all on function public.retry_media_enrichment_job(bigint, uuid, text, timestamp with time zone)
	from public, anon, authenticated;
revoke all on function public.fail_media_enrichment_job(bigint, uuid, text)
	from public, anon, authenticated;

grant execute on function public.claim_media_enrichment_jobs(text, integer, integer)
	to service_role;
grant execute on function public.complete_media_enrichment_job(bigint, uuid, jsonb)
	to service_role;
grant execute on function public.retry_media_enrichment_job(bigint, uuid, text, timestamp with time zone)
	to service_role;
grant execute on function public.fail_media_enrichment_job(bigint, uuid, text)
	to service_role;

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
	if p_crawl_source not in ('arcalive', 'battlepage', 'insagirl') then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;
	if p_items is null or jsonb_typeof(p_items) <> 'array' then
		raise exception using errcode = '22023', message = 'Crawl items must be a JSON array.';
	end if;
	if jsonb_array_length(p_items) > 1000 then
		raise exception using errcode = '22023', message = 'A crawl batch cannot exceed 1000 items.';
	end if;
	if exists (
		select 1
		from jsonb_array_elements(p_items) as payload(item)
		where coalesce(nullif(btrim(item ->> 'type'), ''), 'normal') in ('media', 'issuelink')
	) then
		raise exception using
			errcode = '23514',
			message = 'Retired thread types cannot be ingested.';
	end if;

	with normalized_payload as materialized (
		select distinct on (btrim(item ->> 'url'))
			btrim(item ->> 'url') as url,
			nullif(item ->> 'title', '') as title,
			nullif(item ->> 'description', '') as description,
			nullif(item ->> 'host', '') as host,
			coalesce(nullif(btrim(item ->> 'type'), ''), 'normal') as type,
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
		insert into public.threads (url, title, description, host, type, tag, state)
		select payload.url, payload.title, payload.description, payload.host,
			payload.type, payload.tag, 'inbox'
		from normalized_payload as payload
		inner join claimed using (url)
		returning id, url, type
	),
	inserted_metadata as (
		insert into public.thread_media_metadata (thread_id, provider, status)
		select inserted.id, inserted.type, 'pending'
		from inserted
		where inserted.type in ('youtube', 'imgur')
		returning thread_id, provider
	),
	inserted_jobs as (
		insert into public.media_enrichment_jobs (thread_id, provider, state)
		select inserted_metadata.thread_id, inserted_metadata.provider, 'queued'
		from inserted_metadata
		returning thread_id
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

revoke all on function public.ingest_crawl_items(text, jsonb)
	from public, anon, authenticated;
grant execute on function public.ingest_crawl_items(text, jsonb) to service_role;

insert into public.thread_media_metadata (thread_id, provider, status)
select thread.id, thread.type, 'pending'
from public.threads as thread
where thread.type in ('youtube', 'imgur')
on conflict (thread_id) do nothing;

insert into public.media_enrichment_jobs (thread_id, provider, state)
select metadata.thread_id, metadata.provider, 'queued'
from public.thread_media_metadata as metadata
where metadata.status = 'pending'
on conflict (thread_id) do nothing;

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
	id bigint,
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
		thread.id,
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

commit;
