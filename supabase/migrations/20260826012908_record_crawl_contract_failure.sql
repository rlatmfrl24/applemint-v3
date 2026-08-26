begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.record_crawl_run_contract_failure(
	p_run_id bigint,
	p_lock_token uuid,
	p_error_stage text,
	p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_updated boolean := false;
	v_source text;
begin
	if p_run_id is null or p_run_id <= 0 or p_lock_token is null then
		raise exception using errcode = '22023', message = 'Invalid crawl run contract failure identity.';
	end if;
	if p_error_stage not in ('source', 'filter', 'history', 'ingest', 'unknown') then
		raise exception using errcode = '22023', message = 'Invalid crawl run contract failure stage.';
	end if;
	if nullif(btrim(p_error_message), '') is null or octet_length(p_error_message) > 512 then
		raise exception using errcode = '22023', message = 'Invalid crawl run contract failure message.';
	end if;

	update public.crawl_runs as run
	set
		status = 'failed',
		finished_at = coalesce(run.finished_at, now()),
		duration_ms = coalesce(
			run.duration_ms,
			greatest(0, floor(extract(epoch from (now() - run.started_at)) * 1000)::bigint)
		),
		error_stage = p_error_stage,
		error_message = p_error_message
	where run.id = p_run_id
		and run.lock_token = p_lock_token
	returning true, run.source into v_updated, v_source;

	if coalesce(v_updated, false) then
		delete from public.crawl_run_locks
		where lock_token = p_lock_token
			and lock_key in ('global-crawl', 'crawl:' || v_source);
	end if;

	return coalesce(v_updated, false);
end;
$$;

alter function public.record_crawl_run_contract_failure(bigint, uuid, text, text)
	owner to postgres;

revoke all on function public.record_crawl_run_contract_failure(bigint, uuid, text, text)
	from public, anon, authenticated, service_role;
grant execute on function public.record_crawl_run_contract_failure(bigint, uuid, text, text)
	to service_role;

commit;
