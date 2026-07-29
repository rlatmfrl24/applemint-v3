begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Imgur thread와 crawl-history는 유지하되 외부 API 처리 데이터는 모두 제거한다.
delete from public.thread_media_metadata
where provider = 'imgur';

delete from public.media_worker_dispatches
where provider = 'imgur';

drop function if exists public.set_imgur_enrichment_cooldown(
	timestamp with time zone,
	text
);

alter table public.thread_media_metadata
	drop constraint thread_media_metadata_provider_check,
	drop constraint thread_media_metadata_media_kind_check,
	drop constraint thread_media_metadata_media_count_check,
	drop constraint thread_media_metadata_preview_count_check,
	drop column media_count,
	drop column preview_urls,
	add constraint thread_media_metadata_provider_check
		check (provider = 'youtube'),
	add constraint thread_media_metadata_media_kind_check
		check (
			media_kind is null
			or media_kind in ('video', 'short', 'live', 'unsupported')
		);

alter table public.media_enrichment_jobs
	drop constraint media_enrichment_jobs_provider_check,
	add constraint media_enrichment_jobs_provider_check
		check (provider = 'youtube');

comment on table public.thread_media_metadata is
	'Normalized YouTube metadata summaries. Raw provider API payloads are not stored.';
comment on table public.media_enrichment_jobs is
	'Service-role-only durable queue for YouTube metadata enrichment.';

alter table public.media_worker_dispatches
	drop constraint media_worker_dispatches_provider_check,
	drop constraint media_worker_dispatches_provider_outcome_check,
	drop constraint media_worker_dispatches_provider_diagnostic_counts_check,
	drop constraint media_worker_dispatches_provider_error_counts_check,
	drop constraint media_worker_dispatches_provider_http_status_counts_check,
	drop column provider_outcome,
	drop column api_request_count,
	drop column rate_limited_count,
	drop column provider_error_counts,
	drop column provider_http_status_counts,
	drop column next_available_at,
	drop column provider_cooldown_until,
	drop column rate_limit_client_remaining,
	drop column rate_limit_user_remaining,
	drop column rate_limit_user_reset_at,
	add constraint media_worker_dispatches_provider_check
		check (provider = 'youtube');

comment on table public.media_worker_dispatches is
	'Secret-free pg_net dispatch audit for the YouTube metadata worker.';

drop function if exists private.is_bounded_media_diagnostic_counts(jsonb);
drop function if exists private.is_bounded_media_http_status_counts(jsonb);

alter table public.media_worker_runtime_settings
	drop constraint media_worker_runtime_settings_imgur_batch_check,
	drop constraint media_worker_runtime_settings_imgur_cooldown_reason_check,
	drop column imgur_enabled,
	drop column imgur_batch_size,
	drop column imgur_enrichment_cutoff_at,
	drop column imgur_cooldown_until,
	drop column imgur_cooldown_reason,
	drop column imgur_last_rate_limit_at;

comment on table public.media_worker_runtime_settings is
	'Fail-closed switch and bounded batch size for the YouTube metadata scheduler.';

create or replace function public.claim_media_enrichment_jobs(
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
	if p_provider is null or p_provider <> 'youtube' then
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
		inner join public.threads as thread on thread.id = job.thread_id
		where job.provider = 'youtube'
			and thread.state in ('inbox', 'saved')
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
		for update of job skip locked
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

revoke all on function public.claim_media_enrichment_jobs(text, integer, integer)
	from public, anon, authenticated, service_role;
grant execute on function public.claim_media_enrichment_jobs(text, integer, integer)
	to service_role;

create or replace function public.complete_media_enrichment_job(
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

revoke all on function public.complete_media_enrichment_job(bigint, uuid, jsonb)
	from public, anon, authenticated, service_role;
grant execute on function public.complete_media_enrichment_job(bigint, uuid, jsonb)
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
		select inserted.id, 'youtube', 'pending'
		from inserted
		where inserted.type = 'youtube'
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
	from public, anon, authenticated, service_role;
grant execute on function public.ingest_crawl_items(text, jsonb) to service_role;

create or replace function public.list_threads_page(
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

revoke all on function public.list_threads_page(
	text,
	integer,
	timestamp with time zone,
	bigint,
	text
) from public, anon, authenticated, service_role;
grant execute on function public.list_threads_page(
	text,
	integer,
	timestamp with time zone,
	bigint,
	text
) to authenticated;

create or replace function public.dispatch_due_media_enrichment_workers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
	v_scheduled_for timestamp with time zone;
	v_scheduler_enabled boolean;
	v_youtube_enabled boolean;
	v_youtube_batch_size integer;
	v_base_url text;
	v_internal_secret text;
	v_request_id bigint;
begin
	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended('applemint:media-worker-dispatch', 0)
	);

	select
		settings.scheduler_enabled,
		settings.youtube_enabled,
		settings.youtube_batch_size
	into strict
		v_scheduler_enabled,
		v_youtube_enabled,
		v_youtube_batch_size
	from public.media_worker_runtime_settings as settings
	where settings.id = true;

	if not v_scheduler_enabled then
		return jsonb_build_object('status', 'disabled', 'dispatchedCount', 0);
	end if;
	if not v_youtube_enabled then
		return jsonb_build_object('status', 'idle', 'dispatchedCount', 0);
	end if;
	if not exists (
		select 1
		from public.media_enrichment_jobs as job
		where job.provider = 'youtube'
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
	) then
		return jsonb_build_object('status', 'idle', 'dispatchedCount', 0);
	end if;
	if exists (
		select 1
		from public.media_worker_dispatches as dispatch
		where dispatch.provider = 'youtube'
			and dispatch.state = 'queued'
			and dispatch.created_at > v_now - interval '2 minutes'
	) then
		return jsonb_build_object('status', 'idle', 'dispatchedCount', 0);
	end if;

	select secret.decrypted_secret
	into v_base_url
	from vault.decrypted_secrets as secret
	where secret.name = 'crawl_app_base_url'
	order by secret.created_at desc
	limit 1;

	select secret.decrypted_secret
	into v_internal_secret
	from vault.decrypted_secrets as secret
	where secret.name = 'crawl_internal_secret'
	order by secret.created_at desc
	limit 1;

	v_base_url := rtrim(v_base_url, '/');
	if v_base_url is null
		or v_base_url !~ '^https?://[^[:space:]]+$'
		or v_internal_secret is null
		or octet_length(v_internal_secret) < 32
	then
		update public.media_worker_runtime_settings
		set scheduler_enabled = false, updated_at = v_now
		where id = true and scheduler_enabled;

		return jsonb_build_object(
			'status',
			'configuration-missing',
			'dispatchedCount',
			0
		);
	end if;

	v_scheduled_for := date_bin(
		interval '1 minute',
		v_now,
		'2000-01-01 00:00:00+00'::timestamp with time zone
	);

	select net.http_post(
		url := v_base_url || '/api/media/youtube/enrich',
		headers := jsonb_build_object(
			'Content-Type', 'application/json',
			'x-applemint-internal-secret', v_internal_secret
		),
		body := jsonb_build_object('limit', v_youtube_batch_size),
		timeout_milliseconds := 60000
	)
	into v_request_id;

	insert into public.media_worker_dispatches (
		scheduled_for,
		provider,
		request_id
	)
	values (
		v_scheduled_for,
		'youtube',
		v_request_id
	)
	on conflict (scheduled_for, provider) do nothing;

	return jsonb_build_object(
		'status',
		case when found then 'dispatched' else 'idle' end,
		'dispatchedCount',
		case when found then 1 else 0 end
	);
end;
$$;

revoke all on function public.dispatch_due_media_enrichment_workers()
	from public, anon, authenticated, service_role;
grant execute on function public.dispatch_due_media_enrichment_workers()
	to service_role;

create or replace function public.reconcile_media_worker_dispatches()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
	v_dispatch record;
	v_response record;
	v_body jsonb;
	v_state text;
	v_reason text;
	v_resolved_count bigint := 0;
begin
	for v_dispatch in
		select dispatch.*
		from public.media_worker_dispatches as dispatch
		where dispatch.state = 'queued'
		order by dispatch.created_at, dispatch.id
		for update skip locked
	loop
		select response.*
		into v_response
		from net._http_response as response
		where response.id = v_dispatch.request_id;

		if found then
			begin
				v_body := coalesce(v_response.content, '{}')::jsonb;
			exception when others then
				v_body := '{}'::jsonb;
			end;

			v_reason := nullif(
				left(
					coalesce(
						nullif(btrim(v_body ->> 'reason'), ''),
						case v_response.status_code
							when 401 then 'authentication'
							when 403 then 'authorization'
							when 404 then 'endpoint-not-found'
							when 429 then 'rate-limited'
							else null
						end
					),
					128
				),
				''
			);

			v_state := case
				when coalesce(v_response.timed_out, false)
					or v_response.error_msg is not null
					then 'transport-error'
				when v_response.status_code between 200 and 299
					then 'succeeded'
				when v_response.status_code = 401
					then 'authentication-error'
				when v_response.status_code = 403
					then 'authorization-error'
				when v_response.status_code = 404
					then 'endpoint-not-found'
				when v_response.status_code = 429
					then 'rate-limited'
				when v_response.status_code between 500 and 599
					then 'server-error'
				else 'client-error'
			end;

			update public.media_worker_dispatches
			set
				state = v_state,
				http_status = v_response.status_code,
				response_reason = v_reason,
				claimed_count = private.parse_media_diagnostic_integer(
					v_body ->> 'claimedCount'
				),
				ready_count = private.parse_media_diagnostic_integer(
					v_body ->> 'readyCount'
				),
				unavailable_count = private.parse_media_diagnostic_integer(
					v_body ->> 'unavailableCount'
				),
				unsupported_count = private.parse_media_diagnostic_integer(
					v_body ->> 'unsupportedCount'
				),
				retried_count = private.parse_media_diagnostic_integer(
					v_body ->> 'retriedCount'
				),
				failed_count = private.parse_media_diagnostic_integer(
					v_body ->> 'failedCount'
				),
				lease_rejected_count = private.parse_media_diagnostic_integer(
					v_body ->> 'leaseRejectedCount'
				),
				resolved_at = v_now
			where id = v_dispatch.id;

			if v_response.status_code in (401, 403, 404)
				or v_reason in ('configuration-missing', 'configuration-invalid')
			then
				update public.media_worker_runtime_settings
				set youtube_enabled = false, updated_at = clock_timestamp()
				where id = true and youtube_enabled;
			end if;

			v_resolved_count := v_resolved_count + 1;
		elsif v_dispatch.created_at <= clock_timestamp() - interval '2 minutes' then
			update public.media_worker_dispatches
			set state = 'expired', resolved_at = clock_timestamp()
			where id = v_dispatch.id;
			v_resolved_count := v_resolved_count + 1;
		end if;
	end loop;

	return v_resolved_count;
end;
$$;

revoke all on function public.reconcile_media_worker_dispatches()
	from public, anon, authenticated, service_role;
grant execute on function public.reconcile_media_worker_dispatches()
	to service_role;

commit;
