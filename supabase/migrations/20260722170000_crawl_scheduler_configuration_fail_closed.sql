-- 인증 설정 자체가 누락되거나 잘못된 경우에도 실패 요청을 5분마다 반복하지 않는다.
create or replace function public.reconcile_crawl_schedule_dispatches()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_dispatch record;
	v_response record;
	v_body jsonb;
	v_state text;
	v_reason text;
	v_run_id bigint;
	v_resolved_count bigint := 0;
begin
	for v_dispatch in
		select * from public.crawl_schedule_dispatches
		where state = 'queued'
		order by created_at, id
	loop
		select response.* into v_response
		from net._http_response as response
		where response.id = v_dispatch.request_id;

		if found then
			begin
				v_body := coalesce(v_response.content, '{}')::jsonb;
			exception when others then
				v_body := jsonb_build_object('raw', v_response.content);
			end;

			v_reason := coalesce(
				nullif(v_body ->> 'reason', ''),
				case v_response.status_code
					when 401 then 'authentication'
					when 403 then 'authorization'
					when 404 then 'endpoint-not-found'
					else null
				end
			);
			v_run_id := case
				when coalesce(v_body ->> 'runId', '') ~ '^[0-9]+$' then (v_body ->> 'runId')::bigint
				else null
			end;
			if v_run_id is not null and not exists (
				select 1 from public.crawl_runs where id = v_run_id
			) then
				v_run_id := null;
			end if;
			v_state := case
				when coalesce(v_response.timed_out, false) or v_response.error_msg is not null then 'transport-error'
				when v_body ->> 'status' = 'skipped' or v_reason = 'capacity' then 'skipped'
				when v_response.status_code between 200 and 299 then 'succeeded'
				else 'failed'
			end;

			update public.crawl_schedule_dispatches
			set
				state = v_state,
				http_status = v_response.status_code,
				admission_reason = v_reason,
				run_id = v_run_id,
				response_body = v_body,
				resolved_at = now()
			where id = v_dispatch.id;

			if v_response.status_code in (401, 403)
				or v_reason in ('configuration-missing', 'configuration-invalid')
			then
				update public.crawl_runtime_settings
				set scheduler_enabled = false
				where id = true and scheduler_enabled;
			end if;

			v_resolved_count := v_resolved_count + 1;
		elsif v_dispatch.created_at <= now() - interval '2 minutes' then
			update public.crawl_schedule_dispatches
			set state = 'expired', resolved_at = now()
			where id = v_dispatch.id;
			v_resolved_count := v_resolved_count + 1;
		end if;
	end loop;

	return v_resolved_count;
end;
$$;
