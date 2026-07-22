-- 장애 판정은 데이터가 있는 Postgres에서 수행하고 GitHub Actions는 Issue 전달만 담당한다.
-- GitHub 전달 workflow(7,22,37,52분)보다 2분 먼저 평가해 outbox 반영 시간을 확보한다.
do $$
declare
	v_job_id bigint;
begin
	for v_job_id in
		select jobid
		from cron.job
		where jobname = 'applemint-evaluate-crawl-alerts'
	loop
		perform cron.unschedule(v_job_id);
	end loop;

	perform cron.schedule(
		'applemint-evaluate-crawl-alerts',
		'5,20,35,50 * * * *',
		'select public.evaluate_crawl_alerts(now())'
	);
end;
$$;
