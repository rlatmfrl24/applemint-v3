-- Crawl alert evaluation and owner dashboard contract.
begin;

select plan(16);

select has_table('public', 'crawl_alert_settings', 'crawl alert settings table exists');
select has_table('public', 'crawl_alert_incidents', 'crawl alert incidents table exists');
select ok(
	to_regclass('public.crawl_alert_notifications') is null,
	'GitHub alert delivery outbox is removed'
);
select ok(
	not has_table_privilege('anon', 'public.crawl_alert_incidents', 'SELECT')
		and not has_table_privilege('authenticated', 'public.crawl_alert_incidents', 'SELECT'),
	'client roles cannot read alert internals directly'
);
select ok(
	has_table_privilege('service_role', 'public.crawl_alert_settings', 'SELECT,UPDATE')
		and has_table_privilege('service_role', 'public.crawl_alert_incidents', 'INSERT,UPDATE,DELETE'),
	'service role maintains in-app alert state'
);
select ok(
	has_function_privilege(
		'service_role',
		'public.evaluate_crawl_alerts(timestamp with time zone)',
		'EXECUTE'
	)
		and not has_function_privilege(
			'authenticated',
			'public.evaluate_crawl_alerts(timestamp with time zone)',
			'EXECUTE'
		),
	'alert evaluation remains service-role only'
);
select ok(
	has_function_privilege('authenticated', 'public.get_crawl_alerts_dashboard()', 'EXECUTE')
		and not has_function_privilege('anon', 'public.get_crawl_alerts_dashboard()', 'EXECUTE'),
	'only authenticated owner sessions receive the alert dashboard RPC'
);

create temporary table p3_results (key text primary key, value jsonb not null);
grant all on table p3_results to service_role, authenticated;

set local role service_role;
insert into p3_results values ('empty', public.evaluate_crawl_alerts(now()));
reset role;
select is(
	(select value ->> 'activeIncidentCount' from p3_results where key = 'empty'),
	'0',
	'a source without run history does not produce a no-success alert'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, failure_count, parser_failure_count, parser_valid_count, parser_minimum_count
)
values
	('arcalive', '30000000-0000-4000-8000-000000000001', 'failed', now() - interval '2 hours', now(), now() - interval '119 minutes', 60000, 1, 1, 1, 0, 10),
	('arcalive', '30000000-0000-4000-8000-000000000002', 'failed', now() - interval '1 hour', now(), now() - interval '59 minutes', 60000, 1, 1, 1, 0, 10);

set local role service_role;
insert into p3_results values ('parser', public.evaluate_crawl_alerts(now()));
reset role;
select is(
	(select active_signals from public.crawl_alert_incidents where source = 'arcalive' and status = 'open'),
	array['parser-failure', 'parser-volume-drop']::text[],
	'consecutive parser failures and extraction loss share one incident'
);
select is(
	(select count(*) from public.crawl_alert_incidents where source = 'arcalive'),
	1::bigint,
	'multiple signals create one source incident'
);
select ok(
	not ((select value from p3_results where key = 'parser') ? 'pendingNotificationCount'),
	'alert evaluation no longer returns delivery outbox state'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
insert into p3_results values ('dashboard', public.get_crawl_alerts_dashboard());
reset role;
select is(
	jsonb_array_length((select value -> 'alerts' from p3_results where key = 'dashboard')),
	1,
	'owner dashboard exposes the active in-app incident'
);
select ok(
	not jsonb_path_exists(
		(select value from p3_results where key = 'dashboard'),
		'$.alerts[*].githubIssueNumber'
	)
		and not jsonb_path_exists(
			(select value from p3_results where key = 'dashboard'),
			'$.alerts[*].githubIssueUrl'
		),
	'alert dashboard contains no GitHub Issue metadata'
);
select ok(
	not ((select value -> 'alertSettings' from p3_results where key = 'dashboard') ? 'cooldownSeconds'),
	'alert dashboard contains no GitHub reminder cooldown'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, succeeded_count, parser_valid_count, parser_minimum_count
)
values (
	'arcalive',
	'30000000-0000-4000-8000-000000000003',
	'succeeded',
	now() + interval '1 hour',
	now() + interval '1 hour 5 minutes',
	now() + interval '1 hour 1 minute',
	60000,
	1,
	1,
	10,
	10
);
set local role service_role;
insert into p3_results values ('recovered', public.evaluate_crawl_alerts(now() + interval '2 hours'));
reset role;
select is(
	(select status from public.crawl_alert_incidents where source = 'arcalive'),
	'recovered',
	'a clean parser run resolves all parser signals'
);
select is(
	(select value ->> 'activeIncidentCount' from p3_results where key = 'recovered'),
	'0',
	'recovery leaves no active incidents'
);

select * from finish();
rollback;
