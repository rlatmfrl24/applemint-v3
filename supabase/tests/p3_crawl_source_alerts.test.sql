begin;

select plan(28);

select has_table('public', 'crawl_alert_settings', 'crawl alert settings table exists');
select has_table('public', 'crawl_alert_incidents', 'crawl alert incidents table exists');
select has_table('public', 'crawl_alert_notifications', 'crawl alert outbox exists');
select ok(
	not has_table_privilege('anon', 'public.crawl_alert_incidents', 'SELECT')
		and not has_table_privilege('authenticated', 'public.crawl_alert_incidents', 'SELECT'),
	'client roles cannot read alert internals directly'
);
select ok(
	has_table_privilege('service_role', 'public.crawl_alert_settings', 'SELECT,UPDATE')
		and has_table_privilege('service_role', 'public.crawl_alert_incidents', 'INSERT,UPDATE,DELETE')
		and has_table_privilege('service_role', 'public.crawl_alert_notifications', 'INSERT,UPDATE,DELETE'),
	'service role maintains alert state'
);
select ok(
	has_function_privilege('service_role', 'public.evaluate_crawl_alerts(timestamp with time zone)', 'EXECUTE')
		and has_function_privilege('service_role', 'public.get_pending_crawl_alert_notifications(integer)', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.evaluate_crawl_alerts(timestamp with time zone)', 'EXECUTE'),
	'alert mutation RPCs are service-role only'
);
select ok(
	has_function_privilege('authenticated', 'public.get_crawl_alerts_dashboard()', 'EXECUTE')
		and not has_function_privilege('anon', 'public.get_crawl_alerts_dashboard()', 'EXECUTE'),
	'only authenticated owner sessions receive the alert dashboard RPC'
);

create temporary table p3_results (key text primary key, value jsonb not null);
grant all on table p3_results to service_role;

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
	'consecutive parser failures and severe extraction loss share one incident'
);
select is(
	(select count(*) from public.crawl_alert_incidents where source = 'arcalive'),
	1::bigint,
	'multiple signals create one source incident'
);
select is(
	(select count(*) from public.crawl_alert_notifications where event = 'opened'),
	1::bigint,
	'opening an incident creates one outbox event'
);

set local role service_role;
select public.evaluate_crawl_alerts(now() + interval '1 minute');
reset role;
select is(
	(select count(*) from public.crawl_alert_notifications where delivered_at is null),
	1::bigint,
	'reevaluation does not duplicate an undelivered event'
);

set local role service_role;
select public.complete_crawl_alert_notification(
	(select id from public.crawl_alert_notifications where event = 'opened'),
	101,
	'https://github.com/rlatmfrl24/applemint-v3/issues/101'
);
reset role;
select is(
	(select github_issue_number from public.crawl_alert_incidents where source = 'arcalive'),
	101::bigint,
	'delivery acknowledgement stores the GitHub issue reference'
);

set local role service_role;
select public.evaluate_crawl_alerts(now() + interval '23 hours');
reset role;
select is(
	(select count(*) from public.crawl_alert_notifications where event = 'reminder'),
	0::bigint,
	'cooldown suppresses an early reminder'
);

set local role service_role;
select public.evaluate_crawl_alerts(now() + interval '25 hours');
reset role;
select is(
	(select count(*) from public.crawl_alert_notifications where event = 'reminder'),
	1::bigint,
	'a persistent incident creates one reminder after 24 hours'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, succeeded_count, parser_valid_count, parser_minimum_count
)
values (
	'arcalive', '30000000-0000-4000-8000-000000000003', 'succeeded', now() + interval '26 hours',
	now() + interval '26 hours 5 minutes', now() + interval '26 hours 1 minute', 60000, 1, 1, 10, 10
);
set local role service_role;
select public.evaluate_crawl_alerts(now() + interval '27 hours');
reset role;
select is(
	(select status from public.crawl_alert_incidents where source = 'arcalive'),
	'recovered',
	'a clean parser run at the minimum resolves all parser signals'
);
select is(
	(select count(*) from public.crawl_alert_notifications where event = 'recovered'),
	1::bigint,
	'recovery creates an outbox event'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, failure_count, parser_failure_count, parser_valid_count, parser_minimum_count
)
values
	('arcalive', '30000000-0000-4000-8000-000000000004', 'failed', now() + interval '28 hours', now() + interval '29 hours', now() + interval '28 hours 1 minute', 60000, 1, 1, 1, 0, 10),
	('arcalive', '30000000-0000-4000-8000-000000000005', 'failed', now() + interval '29 hours', now() + interval '30 hours', now() + interval '29 hours 1 minute', 60000, 1, 1, 1, 0, 10);
set local role service_role;
select public.evaluate_crawl_alerts(now() + interval '30 hours');
reset role;
select is(
	(select count(*) from public.crawl_alert_incidents where source = 'arcalive'),
	2::bigint,
	'a failure after recovery starts a new incident episode'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, succeeded_count, parser_valid_count, parser_minimum_count
)
values (
	'insagirl', '30000000-0000-4000-8000-000000000010', 'succeeded', now() - interval '49 hours',
	now() - interval '48 hours 55 minutes', now() - interval '48 hours 59 minutes', 60000, 1, 1, 20, 20
);
set local role service_role;
select public.evaluate_crawl_alerts(now());
reset role;
select is(
	(select active_signals from public.crawl_alert_incidents where source = 'insagirl' and status = 'open'),
	array['no-recent-success']::text[],
	'48 hours without a successful run opens a no-success signal'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, succeeded_count, parser_valid_count, parser_minimum_count
)
values
	('battlepage', '30000000-0000-4000-8000-000000000020', 'partial', now() - interval '3 hours', now(), now() - interval '179 minutes', 60000, 4, 2, 5, 5),
	('battlepage', '30000000-0000-4000-8000-000000000021', 'partial', now() - interval '2 hours', now(), now() - interval '119 minutes', 60000, 4, 2, 5, 10);
set local role service_role;
select public.evaluate_crawl_alerts(now());
reset role;
select is(
	(select count(*) from public.crawl_alert_incidents where source = 'battlepage' and status = 'open'),
	0::bigint,
	'exactly 50 percent extraction does not cross the drop threshold'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, succeeded_count, failure_count, network_failure_count,
	parser_valid_count, parser_minimum_count
)
values
	('battlepage', '30000000-0000-4000-8000-000000000030', 'partial', now() - interval '50 minutes', now(), now() - interval '49 minutes', 60000, 4, 2, 2, 2, 5, 5),
	('battlepage', '30000000-0000-4000-8000-000000000031', 'partial', now() - interval '40 minutes', now(), now() - interval '39 minutes', 60000, 4, 2, 2, 2, 5, 5),
	('battlepage', '30000000-0000-4000-8000-000000000032', 'partial', now() - interval '30 minutes', now(), now() - interval '29 minutes', 60000, 4, 2, 2, 2, 5, 5);
set local role service_role;
select public.evaluate_crawl_alerts(now());
reset role;
select ok(
	(
		select 'transport-error-rate' = any(active_signals)
		from public.crawl_alert_incidents
		where source = 'battlepage' and status = 'open'
	),
	'50 percent network and timeout failures across three runs triggers transport alerting'
);

insert into public.crawl_runs (
	source, lock_token, status, started_at, stale_after, finished_at, duration_ms,
	attempted_count, succeeded_count, parser_valid_count, parser_minimum_count
)
values
	('battlepage', '30000000-0000-4000-8000-000000000033', 'succeeded', now() + interval '1 hour', now() + interval '2 hours', now() + interval '61 minutes', 60000, 4, 4, 5, 5),
	('battlepage', '30000000-0000-4000-8000-000000000034', 'succeeded', now() + interval '2 hours', now() + interval '3 hours', now() + interval '121 minutes', 60000, 4, 4, 5, 5);
set local role service_role;
select public.evaluate_crawl_alerts(now() + interval '3 hours');
reset role;
select is(
	(select status from public.crawl_alert_incidents where source = 'battlepage'),
	'recovered',
	'two transport-clean runs resolve a transport incident'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
	$$select public.get_crawl_alerts_dashboard()$$,
	'42501',
	'Only the Applemint owner can read crawl alerts.',
	'non-owner cannot read crawl alert status'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select ok(
	jsonb_typeof(public.get_crawl_alerts_dashboard() -> 'alerts') = 'array'
		and (public.get_crawl_alerts_dashboard() -> 'alertSettings' ->> 'cooldownSeconds')::integer = 86400,
	'owner receives current alerts and read-only threshold settings'
);
reset role;

set local role service_role;
select public.fail_crawl_alert_notification(
	(select id from public.crawl_alert_notifications where delivered_at is null order by id limit 1),
	'github_delivery_failed'
);
reset role;
select is(
	(
		select last_error from public.crawl_alert_notifications
		where delivery_attempt_count = 1 and delivered_at is null
		order by id limit 1
	),
	'github_delivery_failed',
	'a safe delivery failure code is retained for retry diagnostics'
);

select is(
	(
		select count(*)
		from public.get_pending_crawl_alert_notifications(100) as ignored
	),
	1::bigint,
	'pending notification RPC returns one JSON value'
);
set local role service_role;
select ok(
	jsonb_array_length(public.get_pending_crawl_alert_notifications(100)) > 0,
	'pending notification RPC returns undelivered events'
);
reset role;

insert into public.crawl_alert_incidents (
	source, status, active_signals, opened_at, last_observed_at, recovered_at, snapshot
)
values (
	'battlepage', 'recovered', array['parser-failure'], now() - interval '91 days',
	now() - interval '91 days', now() - interval '91 days', '{}'::jsonb
);
insert into public.crawl_alert_notifications (
	incident_id, event, payload, created_at, delivered_at
)
values (
	(select id from public.crawl_alert_incidents where source = 'battlepage' and opened_at < now() - interval '90 days'),
	'recovered', '{}', now() - interval '91 days', now() - interval '91 days'
);
select public.cleanup_crawl_runs();
select is(
	(select count(*) from public.crawl_alert_incidents where opened_at < now() - interval '90 days'),
	0::bigint,
	'cleanup removes delivered recovered incidents after 90 days'
);

select * from finish();
rollback;
