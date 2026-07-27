begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.media_worker_runtime_settings (
	id boolean primary key default true,
	scheduler_enabled boolean not null default false,
	youtube_batch_size integer not null default 50,
	imgur_batch_size integer not null default 20,
	updated_at timestamp with time zone not null default now(),
	constraint media_worker_runtime_settings_singleton_check check (id),
	constraint media_worker_runtime_settings_youtube_batch_check
		check (youtube_batch_size between 1 and 50),
	constraint media_worker_runtime_settings_imgur_batch_check
		check (imgur_batch_size between 1 and 20)
);

comment on table public.media_worker_runtime_settings is
	'Fail-closed switch and bounded batch sizes for the media-only scheduler.';

insert into public.media_worker_runtime_settings (
	id,
	scheduler_enabled,
	youtube_batch_size,
	imgur_batch_size
)
values (true, false, 50, 20);

create table public.media_worker_dispatches (
	id bigint generated always as identity primary key,
	scheduled_for timestamp with time zone not null,
	provider text not null,
	request_id bigint,
	state text not null default 'queued',
	http_status integer,
	response_reason text,
	claimed_count integer,
	ready_count integer,
	unavailable_count integer,
	unsupported_count integer,
	retried_count integer,
	failed_count integer,
	lease_rejected_count integer,
	created_at timestamp with time zone not null default now(),
	resolved_at timestamp with time zone,
	constraint media_worker_dispatches_provider_check
		check (provider in ('youtube', 'imgur')),
	constraint media_worker_dispatches_state_check
		check (
			state in (
				'queued',
				'succeeded',
				'authentication-error',
				'authorization-error',
				'endpoint-not-found',
				'rate-limited',
				'server-error',
				'client-error',
				'transport-error',
				'expired'
			)
		),
	constraint media_worker_dispatches_http_status_check
		check (http_status is null or http_status between 100 and 599),
	constraint media_worker_dispatches_response_reason_check
		check (
			response_reason is null
			or char_length(response_reason) between 1 and 128
		),
	constraint media_worker_dispatches_counts_check
		check (
			(claimed_count is null or claimed_count >= 0)
			and (ready_count is null or ready_count >= 0)
			and (unavailable_count is null or unavailable_count >= 0)
			and (unsupported_count is null or unsupported_count >= 0)
			and (retried_count is null or retried_count >= 0)
			and (failed_count is null or failed_count >= 0)
			and (lease_rejected_count is null or lease_rejected_count >= 0)
		),
	constraint media_worker_dispatches_unique_bucket_provider
		unique (scheduled_for, provider)
);

comment on table public.media_worker_dispatches is
	'Secret-free pg_net dispatch audit for YouTube and Imgur metadata workers.';

create index media_worker_dispatches_queued_created_at_idx
	on public.media_worker_dispatches (created_at, id)
	where state = 'queued';

alter table public.media_worker_runtime_settings enable row level security;
alter table public.media_worker_dispatches enable row level security;

create policy "Service role can manage media worker runtime settings"
	on public.media_worker_runtime_settings
	for all
	to service_role
	using (true)
	with check (true);

create policy "Service role can manage media worker dispatches"
	on public.media_worker_dispatches
	for all
	to service_role
	using (true)
	with check (true);

revoke all on table public.media_worker_runtime_settings
	from public, anon, authenticated, service_role;
revoke all on table public.media_worker_dispatches
	from public, anon, authenticated, service_role;
revoke all on sequence public.media_worker_dispatches_id_seq
	from public, anon, authenticated, service_role;

grant select, update on table public.media_worker_runtime_settings to service_role;
grant select, insert, update, delete on table public.media_worker_dispatches to service_role;
grant usage, select on sequence public.media_worker_dispatches_id_seq to service_role;

create function public.dispatch_due_media_enrichment_workers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
	v_scheduled_for timestamp with time zone;
	v_scheduler_enabled boolean;
	v_youtube_batch_size integer;
	v_imgur_batch_size integer;
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
		settings.youtube_batch_size,
		settings.imgur_batch_size
	into strict
		v_scheduler_enabled,
		v_youtube_batch_size,
		v_imgur_batch_size
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

create function public.reconcile_media_worker_dispatches()
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
				claimed_count = case
					when coalesce(v_body ->> 'claimedCount', '') ~ '^[0-9]+$'
						then (v_body ->> 'claimedCount')::integer
					else null
				end,
				ready_count = case
					when coalesce(v_body ->> 'readyCount', '') ~ '^[0-9]+$'
						then (v_body ->> 'readyCount')::integer
					else null
				end,
				unavailable_count = case
					when coalesce(v_body ->> 'unavailableCount', '') ~ '^[0-9]+$'
						then (v_body ->> 'unavailableCount')::integer
					else null
				end,
				unsupported_count = case
					when coalesce(v_body ->> 'unsupportedCount', '') ~ '^[0-9]+$'
						then (v_body ->> 'unsupportedCount')::integer
					else null
				end,
				retried_count = case
					when coalesce(v_body ->> 'retriedCount', '') ~ '^[0-9]+$'
						then (v_body ->> 'retriedCount')::integer
					else null
				end,
				failed_count = case
					when coalesce(v_body ->> 'failedCount', '') ~ '^[0-9]+$'
						then (v_body ->> 'failedCount')::integer
					else null
				end,
				lease_rejected_count = case
					when coalesce(v_body ->> 'leaseRejectedCount', '') ~ '^[0-9]+$'
						then (v_body ->> 'leaseRejectedCount')::integer
					else null
				end,
				resolved_at = v_now
			where id = v_dispatch.id;

			if v_response.status_code in (401, 403, 404)
				or v_reason in ('configuration-missing', 'configuration-invalid')
			then
				update public.media_worker_runtime_settings
				set scheduler_enabled = false, updated_at = clock_timestamp()
				where id = true and scheduler_enabled;
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

create function public.cleanup_media_worker_dispatches()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_deleted_count bigint;
begin
	delete from public.media_worker_dispatches
	where created_at < clock_timestamp() - interval '30 days';
	get diagnostics v_deleted_count = row_count;
	return v_deleted_count;
end;
$$;

revoke all on function public.dispatch_due_media_enrichment_workers()
	from public, anon, authenticated, service_role;
revoke all on function public.reconcile_media_worker_dispatches()
	from public, anon, authenticated, service_role;
revoke all on function public.cleanup_media_worker_dispatches()
	from public, anon, authenticated, service_role;

grant execute on function public.dispatch_due_media_enrichment_workers()
	to service_role;
grant execute on function public.reconcile_media_worker_dispatches()
	to service_role;

do $$
declare
	v_job_id bigint;
begin
	for v_job_id in
		select jobid
		from cron.job
		where jobname in (
			'applemint-dispatch-media-workers',
			'applemint-reconcile-media-worker-dispatches',
			'applemint-clean-media-worker-dispatches'
		)
	loop
		perform cron.unschedule(v_job_id);
	end loop;

	perform cron.schedule(
		'applemint-dispatch-media-workers',
		'* * * * *',
		'select public.dispatch_due_media_enrichment_workers()'
	);
	perform cron.schedule(
		'applemint-reconcile-media-worker-dispatches',
		'* * * * *',
		'select public.reconcile_media_worker_dispatches()'
	);
	perform cron.schedule(
		'applemint-clean-media-worker-dispatches',
		'50 18 * * *',
		'select public.cleanup_media_worker_dispatches()'
	);
end;
$$;

commit;
