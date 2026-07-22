begin;

select plan(2);

select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-evaluate-crawl-alerts'
			and schedule = '5,20,35,50 * * * *'
	),
	1::bigint,
	'crawl alert evaluation runs once every fifteen minutes before delivery'
);

select is(
	(
		select command
		from cron.job
		where jobname = 'applemint-evaluate-crawl-alerts'
	),
	'select public.evaluate_crawl_alerts(now())',
	'cron evaluates alert state inside Postgres'
);

select * from finish();

rollback;
