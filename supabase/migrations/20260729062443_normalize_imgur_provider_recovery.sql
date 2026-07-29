begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.media_worker_runtime_settings
	add column imgur_cooldown_until timestamp with time zone,
	add column imgur_cooldown_reason text,
	add column imgur_last_rate_limit_at timestamp with time zone,
	add constraint media_worker_runtime_settings_imgur_cooldown_reason_check
		check (
			imgur_cooldown_reason is null
			or imgur_cooldown_reason in (
				'IMGUR_CLIENT_QUOTA_EXHAUSTED',
				'IMGUR_USER_RATE_LIMITED',
				'IMGUR_HTTP_429'
			)
		);

alter table public.media_worker_runtime_settings
	alter column imgur_enabled set default false,
	alter column imgur_batch_size set default 1;

update public.media_worker_runtime_settings
set
	imgur_enabled = false,
	imgur_batch_size = 1,
	updated_at = clock_timestamp()
where id = true;

alter table public.media_worker_runtime_settings
	drop constraint media_worker_runtime_settings_imgur_batch_check,
	add constraint media_worker_runtime_settings_imgur_batch_check
		check (imgur_batch_size between 1 and 2);

comment on column public.media_worker_runtime_settings.imgur_batch_size is
	'Maximum Imgur jobs claimed per dispatch. Production recovery starts at one sequential job.';
comment on column public.media_worker_runtime_settings.imgur_cooldown_until is
	'Provider-level Imgur API cooldown. Dispatcher skips only Imgur while this time is in the future.';
comment on column public.media_worker_runtime_settings.imgur_cooldown_reason is
	'Safe normalized Imgur rate-limit code that caused the current cooldown.';
comment on column public.media_worker_runtime_settings.imgur_last_rate_limit_at is
	'Last time an Imgur rate-limit signal extended or confirmed provider cooldown.';

create function private.is_bounded_media_diagnostic_counts(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
	select
		jsonb_typeof(p_value) = 'object'
		and octet_length(p_value::text) <= 2048
		and (
			select count(*) <= 16
			from jsonb_object_keys(p_value)
		)
		and not exists (
			select 1
			from jsonb_each(p_value) as entry(key, value)
			where char_length(entry.key) not between 1 and 128
				or jsonb_typeof(entry.value) <> 'number'
				or entry.value::text !~ '^[0-9]+$'
		)
$$;

revoke all on function private.is_bounded_media_diagnostic_counts(jsonb)
	from public, anon, authenticated, service_role;
grant execute on function private.is_bounded_media_diagnostic_counts(jsonb)
	to service_role;

create function private.is_bounded_media_http_status_counts(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
	select
		jsonb_typeof(p_value) = 'object'
		and octet_length(p_value::text) <= 2048
		and (
			select count(*) <= 16
			from jsonb_object_keys(p_value)
		)
		and not exists (
			select 1
			from jsonb_each(p_value) as entry(key, value)
			where jsonb_typeof(entry.value) <> 'number'
				or entry.value::text !~ '^[0-9]+$'
		)
		and not exists (
			select 1
			from jsonb_object_keys(p_value) as status(key)
			where status.key !~ '^[1-5][0-9]{2}$'
		)
$$;

revoke all on function private.is_bounded_media_http_status_counts(jsonb)
	from public, anon, authenticated, service_role;
grant execute on function private.is_bounded_media_http_status_counts(jsonb)
	to service_role;

create function private.parse_media_diagnostic_integer(p_value text)
returns integer
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
declare
	v_value bigint;
begin
	if p_value !~ '^[0-9]+$' or char_length(p_value) > 10 then
		return null;
	end if;
	v_value := p_value::bigint;
	if v_value > 2147483647 then
		return null;
	end if;
	return v_value::integer;
exception when others then
	return null;
end;
$$;

revoke all on function private.parse_media_diagnostic_integer(text)
	from public, anon, authenticated, service_role;

alter table public.media_worker_dispatches
	add column provider_outcome text,
	add column api_request_count integer,
	add column rate_limited_count integer,
	add column provider_error_counts jsonb,
	add column provider_http_status_counts jsonb,
	add column next_available_at timestamp with time zone,
	add column provider_cooldown_until timestamp with time zone,
	add column rate_limit_client_remaining integer,
	add column rate_limit_user_remaining integer,
	add column rate_limit_user_reset_at timestamp with time zone,
	add constraint media_worker_dispatches_provider_outcome_check
		check (
			provider_outcome is null
			or provider_outcome in (
				'idle',
				'completed',
				'partial',
				'retrying',
				'rate-limited',
				'failed'
			)
		),
	add constraint media_worker_dispatches_provider_diagnostic_counts_check
		check (
			(api_request_count is null or api_request_count >= 0)
			and (rate_limited_count is null or rate_limited_count >= 0)
			and (
				rate_limit_client_remaining is null
				or rate_limit_client_remaining >= 0
			)
			and (
				rate_limit_user_remaining is null
				or rate_limit_user_remaining >= 0
			)
		),
	add constraint media_worker_dispatches_provider_error_counts_check
		check (
			provider_error_counts is null
			or private.is_bounded_media_diagnostic_counts(provider_error_counts)
		),
	add constraint media_worker_dispatches_provider_http_status_counts_check
		check (
			provider_http_status_counts is null
			or private.is_bounded_media_http_status_counts(provider_http_status_counts)
		);

comment on column public.media_worker_dispatches.provider_outcome is
	'Provider processing outcome returned inside a successful worker transport response.';
comment on column public.media_worker_dispatches.api_request_count is
	'Actual provider API request count reported by the worker; no URL or credential is stored.';
comment on column public.media_worker_dispatches.provider_error_counts is
	'Bounded safe error-code aggregate for this dispatch. Raw provider payloads are not stored.';
comment on column public.media_worker_dispatches.provider_http_status_counts is
	'Bounded provider API HTTP status aggregate for this dispatch.';

create function public.set_imgur_enrichment_cooldown(
	p_until timestamp with time zone,
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
	v_existing_until timestamp with time zone;
	v_existing_reason text;
	v_effective_until timestamp with time zone;
	v_effective_reason text;
begin
	if p_until is null
		or p_until < v_now + interval '30 seconds'
		or p_until > v_now + interval '25 hours 5 minutes'
	then
		raise exception using
			errcode = '22023',
			message = 'Imgur cooldown must be between one minute and 25 hours.';
	end if;
	if v_error_code is null
		or v_error_code not in (
			'IMGUR_CLIENT_QUOTA_EXHAUSTED',
			'IMGUR_USER_RATE_LIMITED',
			'IMGUR_HTTP_429'
		)
	then
		raise exception using
			errcode = '22023',
			message = 'Unsupported Imgur cooldown reason.';
	end if;

	select settings.imgur_cooldown_until, settings.imgur_cooldown_reason
	into strict v_existing_until, v_existing_reason
	from public.media_worker_runtime_settings as settings
	where settings.id = true
	for update;

	if v_existing_until is not null and v_existing_until >= p_until then
		v_effective_until := v_existing_until;
		v_effective_reason := coalesce(v_existing_reason, v_error_code);
	else
		v_effective_until := p_until;
		v_effective_reason := v_error_code;
	end if;

	update public.media_worker_runtime_settings
	set
		imgur_cooldown_until = v_effective_until,
		imgur_cooldown_reason = v_effective_reason,
		imgur_last_rate_limit_at = v_now,
		updated_at = v_now
	where id = true;

	update public.media_enrichment_jobs
	set
		available_at = greatest(available_at, v_effective_until),
		last_error_code = v_effective_reason,
		updated_at = v_now
	where provider = 'imgur'
		and state in ('queued', 'retry');

	update public.thread_media_metadata as metadata
	set
		status = 'pending',
		last_error_code = v_effective_reason,
		updated_at = v_now
	where metadata.provider = 'imgur'
		and metadata.status = 'pending'
		and exists (
			select 1
			from public.media_enrichment_jobs as job
			where job.thread_id = metadata.thread_id
				and job.provider = 'imgur'
				and job.state in ('queued', 'retry')
		);

	return true;
end;
$$;

revoke all on function public.set_imgur_enrichment_cooldown(
	timestamp with time zone,
	text
) from public, anon, authenticated, service_role;
grant execute on function public.set_imgur_enrichment_cooldown(
	timestamp with time zone,
	text
) to service_role;

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
	if p_provider is null or p_provider not in ('youtube', 'imgur') then
		raise exception using errcode = '22023', message = 'Unsupported media provider.';
	end if;
	if p_limit is null or p_limit < 1 or p_limit > 100 then
		raise exception using errcode = '22023', message = 'Claim limit must be between 1 and 100.';
	end if;
	if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
		raise exception using errcode = '22023', message = 'Lease duration must be between 1 and 3600 seconds.';
	end if;

	if p_provider = 'imgur'
		and exists (
			select 1
			from public.media_worker_runtime_settings as settings
			where settings.id = true
				and settings.imgur_cooldown_until > v_now
		)
	then
		return;
	end if;

	return query
	with candidates as materialized (
		select job.thread_id
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where job.provider = p_provider
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
	v_now timestamp with time zone := clock_timestamp();
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
		insert into public.thread_media_metadata (
			thread_id,
			provider,
			status,
			last_error_code
		)
		select
			inserted.id,
			inserted.type,
			'pending',
			case
				when inserted.type = 'imgur'
					and settings.imgur_cooldown_until > v_now
				then coalesce(settings.imgur_cooldown_reason, 'IMGUR_HTTP_429')
				else null
			end
		from inserted
		cross join public.media_worker_runtime_settings as settings
		where settings.id = true
			and inserted.type in ('youtube', 'imgur')
		returning thread_id, provider, last_error_code
	),
	inserted_jobs as (
		insert into public.media_enrichment_jobs (
			thread_id,
			provider,
			state,
			available_at,
			last_error_code
		)
		select
			inserted_metadata.thread_id,
			inserted_metadata.provider,
			'queued',
			case
				when inserted_metadata.provider = 'imgur'
					and settings.imgur_cooldown_until > v_now
				then settings.imgur_cooldown_until
				else v_now
			end,
			inserted_metadata.last_error_code
		from inserted_metadata
		cross join public.media_worker_runtime_settings as settings
		where settings.id = true
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
	v_imgur_enabled boolean;
	v_youtube_batch_size integer;
	v_imgur_batch_size integer;
	v_imgur_cooldown_until timestamp with time zone;
	v_base_url text;
	v_internal_secret text;
	v_provider text;
	v_endpoint text;
	v_batch_size integer;
	v_request_id bigint;
	v_dispatched_count integer := 0;
begin
	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended('applemint:media-worker-dispatch', 0)
	);

	select
		settings.scheduler_enabled,
		settings.youtube_enabled,
		settings.imgur_enabled,
		settings.youtube_batch_size,
		settings.imgur_batch_size,
		settings.imgur_cooldown_until
	into strict
		v_scheduler_enabled,
		v_youtube_enabled,
		v_imgur_enabled,
		v_youtube_batch_size,
		v_imgur_batch_size,
		v_imgur_cooldown_until
	from public.media_worker_runtime_settings as settings
	where settings.id = true;

	if not v_scheduler_enabled then
		return jsonb_build_object('status', 'disabled', 'dispatchedCount', 0);
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

	foreach v_provider in array array['youtube', 'imgur']::text[]
	loop
		if (v_provider = 'youtube' and not v_youtube_enabled)
			or (v_provider = 'imgur' and not v_imgur_enabled)
			or (
				v_provider = 'imgur'
				and v_imgur_cooldown_until is not null
				and v_imgur_cooldown_until > v_now
			)
		then
			continue;
		end if;

		if not exists (
			select 1
			from public.media_enrichment_jobs as job
			where job.provider = v_provider
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
			continue;
		end if;

		if exists (
			select 1
			from public.media_worker_dispatches as dispatch
			where dispatch.provider = v_provider
				and dispatch.state = 'queued'
				and dispatch.created_at > v_now - interval '2 minutes'
		) then
			continue;
		end if;

		if v_provider = 'youtube' then
			v_endpoint := '/api/media/youtube/enrich';
			v_batch_size := v_youtube_batch_size;
		else
			v_endpoint := '/api/media/imgur/enrich';
			v_batch_size := v_imgur_batch_size;
		end if;

		select net.http_post(
			url := v_base_url || v_endpoint,
			headers := jsonb_build_object(
				'Content-Type', 'application/json',
				'x-applemint-internal-secret', v_internal_secret
			),
			body := jsonb_build_object('limit', v_batch_size),
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
			v_provider,
			v_request_id
		)
		on conflict (scheduled_for, provider) do nothing;

		if found then
			v_dispatched_count := v_dispatched_count + 1;
		end if;
	end loop;

	return jsonb_build_object(
		'status',
		case when v_dispatched_count > 0 then 'dispatched' else 'idle' end,
		'dispatchedCount',
		v_dispatched_count
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
	v_diagnostics jsonb;
	v_state text;
	v_reason text;
	v_provider_outcome text;
	v_error_counts jsonb;
	v_http_status_counts jsonb;
	v_next_available_at timestamp with time zone;
	v_cooldown_until timestamp with time zone;
	v_rate_limit_user_reset_at timestamp with time zone;
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

			v_diagnostics := case
				when jsonb_typeof(v_body -> 'diagnostics') = 'object'
					then v_body -> 'diagnostics'
				else '{}'::jsonb
			end;
			v_provider_outcome := case
				when v_diagnostics ->> 'providerOutcome' in (
					'idle',
					'completed',
					'partial',
					'retrying',
					'rate-limited',
					'failed'
				) then v_diagnostics ->> 'providerOutcome'
				else null
			end;
			v_error_counts := case
				when jsonb_typeof(v_diagnostics -> 'errorCounts') = 'object'
					and private.is_bounded_media_diagnostic_counts(
						v_diagnostics -> 'errorCounts'
					)
				then v_diagnostics -> 'errorCounts'
				else null
			end;
			v_http_status_counts := case
				when jsonb_typeof(v_diagnostics -> 'httpStatusCounts') = 'object'
					and private.is_bounded_media_http_status_counts(
						v_diagnostics -> 'httpStatusCounts'
					)
				then v_diagnostics -> 'httpStatusCounts'
				else null
			end;

			v_next_available_at := null;
			v_cooldown_until := null;
			v_rate_limit_user_reset_at := null;
			begin
				v_next_available_at :=
					nullif(v_diagnostics ->> 'nextAvailableAt', '')::timestamp with time zone;
			exception when others then
				v_next_available_at := null;
			end;
			begin
				v_cooldown_until :=
					nullif(v_diagnostics ->> 'cooldownUntil', '')::timestamp with time zone;
			exception when others then
				v_cooldown_until := null;
			end;
			begin
				v_rate_limit_user_reset_at :=
					nullif(v_diagnostics #>> '{rateLimit,userResetAt}', '')::timestamp with time zone;
			exception when others then
				v_rate_limit_user_reset_at := null;
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
				provider_outcome = v_provider_outcome,
				api_request_count = private.parse_media_diagnostic_integer(
					v_diagnostics ->> 'apiRequestCount'
				),
				rate_limited_count = private.parse_media_diagnostic_integer(
					v_diagnostics ->> 'rateLimitedCount'
				),
				provider_error_counts = v_error_counts,
				provider_http_status_counts = v_http_status_counts,
				next_available_at = v_next_available_at,
				provider_cooldown_until = v_cooldown_until,
				rate_limit_client_remaining = private.parse_media_diagnostic_integer(
					v_diagnostics #>> '{rateLimit,clientRemaining}'
				),
				rate_limit_user_remaining = private.parse_media_diagnostic_integer(
					v_diagnostics #>> '{rateLimit,userRemaining}'
				),
				rate_limit_user_reset_at = v_rate_limit_user_reset_at,
				resolved_at = v_now
			where id = v_dispatch.id;

			if v_response.status_code in (401, 403, 404)
				or v_reason in ('configuration-missing', 'configuration-invalid')
			then
				update public.media_worker_runtime_settings
				set
					youtube_enabled = case
						when v_dispatch.provider = 'youtube' then false
						else youtube_enabled
					end,
					imgur_enabled = case
						when v_dispatch.provider = 'imgur' then false
						else imgur_enabled
					end,
					updated_at = clock_timestamp()
				where id = true
					and (
						(v_dispatch.provider = 'youtube' and youtube_enabled)
						or (v_dispatch.provider = 'imgur' and imgur_enabled)
					);
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
