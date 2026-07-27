begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.media_worker_runtime_settings
	add column youtube_enabled boolean not null default true,
	add column imgur_enabled boolean not null default true;

comment on column public.media_worker_runtime_settings.youtube_enabled is
	'YouTube worker dispatch switch. The global media scheduler must also be enabled.';
comment on column public.media_worker_runtime_settings.imgur_enabled is
	'Imgur worker dispatch switch. Disabled providers keep their durable jobs unchanged.';

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
		settings.imgur_batch_size
	into strict
		v_scheduler_enabled,
		v_youtube_enabled,
		v_imgur_enabled,
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
		if (v_provider = 'youtube' and not v_youtube_enabled)
			or (v_provider = 'imgur' and not v_imgur_enabled)
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

commit;
