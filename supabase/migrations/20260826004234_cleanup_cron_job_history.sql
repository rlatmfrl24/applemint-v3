create or replace function public.cleanup_cron_job_run_details()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_deleted_count bigint;
begin
	with expired_rows as (
		select history.ctid
		from cron.job_run_details as history
		where history.end_time is not null
			and history.start_time < now() - interval '14 days'
		order by history.start_time, history.runid
		limit 10000
		for update skip locked
	)
	delete from cron.job_run_details as history
	using expired_rows
	where history.ctid = expired_rows.ctid;

	get diagnostics v_deleted_count = row_count;
	return v_deleted_count;
end;
$$;

alter function public.cleanup_cron_job_run_details() owner to postgres;

revoke all on function public.cleanup_cron_job_run_details()
	from public, anon, authenticated, service_role;

do $$
declare
	v_job_id bigint;
begin
	for v_job_id in
		select jobid
		from cron.job
		where jobname = 'applemint-clean-cron-history'
	loop
		perform cron.unschedule(v_job_id);
	end loop;

	perform cron.schedule(
		'applemint-clean-cron-history',
		'5 19 * * *',
		'select public.cleanup_cron_job_run_details()'
	);
end;
$$;
