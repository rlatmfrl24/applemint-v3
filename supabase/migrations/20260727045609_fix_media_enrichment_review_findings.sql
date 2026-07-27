begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.media_worker_runtime_settings
	alter column imgur_batch_size set default 4;

update public.media_worker_runtime_settings
set
	imgur_batch_size = least(imgur_batch_size, 4),
	updated_at = clock_timestamp()
where imgur_batch_size > 4;

alter table public.media_worker_runtime_settings
	drop constraint media_worker_runtime_settings_imgur_batch_check,
	add constraint media_worker_runtime_settings_imgur_batch_check
		check (imgur_batch_size between 1 and 4);

comment on column public.media_worker_runtime_settings.imgur_batch_size is
	'Maximum Imgur jobs claimed per dispatch. Kept at one four-request concurrency wave.';

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
				where id = true
					and scheduler_enabled
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
