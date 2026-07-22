begin;

select plan(5);

update public.crawl_runtime_settings set scheduler_enabled = true where id = true;

insert into public.crawl_schedule_dispatches (
	scheduled_for, source, request_id, state
)
values ('2026-07-22 16:00:00+00', 'arcalive', 8800001, 'queued');

insert into net._http_response (
	id, status_code, content_type, headers, content, timed_out, error_msg
)
values (
	8800001,
	401,
	'application/json',
	'{}'::jsonb,
	'{"error":"unauthorized","reason":"invalid-secret"}',
	false,
	null
);

set local role service_role;
select is(
	public.reconcile_crawl_schedule_dispatches(),
	1::bigint,
	'reconciler settles an authentication failure'
);
reset role;

select is(
	(select state from public.crawl_schedule_dispatches where request_id = 8800001),
	'failed',
	'authentication response is recorded as failed'
);
select is(
	(select admission_reason from public.crawl_schedule_dispatches where request_id = 8800001),
	'invalid-secret',
	'endpoint authentication reason is preserved for operations'
);
select is(
	(select scheduler_enabled from public.crawl_runtime_settings where id = true),
	false,
	'authentication failure disables scheduled dispatches'
);
select is(
	(select response_body ->> 'error' from public.crawl_schedule_dispatches where request_id = 8800001),
	'unauthorized',
	'safe response details remain available in the dispatch audit'
);

select * from finish();

rollback;
