-- YouTube-only media Cron, pg_net dispatch, and fail-closed contract.
begin;

select no_plan();

select has_table(
	'public',
	'media_worker_runtime_settings',
	'YouTube worker runtime singleton exists'
);
select has_table(
	'public',
	'media_worker_dispatches',
	'YouTube worker dispatch audit exists'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'scheduler_enabled',
	'media scheduler keeps an independent global switch'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'youtube_enabled',
	'YouTube worker keeps an independent provider switch'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'youtube_batch_size',
	'YouTube worker keeps a bounded batch size'
);
select is(
	(
		select count(*)
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'media_worker_runtime_settings'
			and column_name like 'imgur%'
	),
	0::bigint,
	'Imgur scheduler and cooldown settings are removed'
);
select is(
	(
		select count(*)
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'media_worker_dispatches'
			and column_name in (
				'provider_outcome',
				'api_request_count',
				'rate_limited_count',
				'provider_error_counts',
				'provider_http_status_counts',
				'next_available_at',
				'provider_cooldown_until',
				'rate_limit_client_remaining',
				'rate_limit_user_remaining',
				'rate_limit_user_reset_at'
			)
	),
	0::bigint,
	'Imgur provider diagnostics columns are removed'
);
select ok(
	(
		select pg_get_constraintdef(oid)
		from pg_constraint
		where conrelid = 'public.media_worker_dispatches'::regclass
			and conname = 'media_worker_dispatches_provider_check'
	) like '%youtube%'
		and (
			select pg_get_constraintdef(oid)
			from pg_constraint
			where conrelid = 'public.media_worker_dispatches'::regclass
				and conname = 'media_worker_dispatches_provider_check'
		) not like '%imgur%',
	'dispatch audit accepts only YouTube'
);
select ok(
	(
		select relrowsecurity
		from pg_class
		where oid = 'public.media_worker_runtime_settings'::regclass
	)
		and (
			select relrowsecurity
			from pg_class
			where oid = 'public.media_worker_dispatches'::regclass
		),
	'scheduler tables keep RLS enabled'
);
select ok(
	has_table_privilege(
		'service_role',
		'public.media_worker_runtime_settings',
		'SELECT,UPDATE'
	)
		and has_table_privilege(
			'service_role',
			'public.media_worker_dispatches',
			'SELECT,INSERT,UPDATE,DELETE'
		)
		and not has_table_privilege(
			'authenticated',
			'public.media_worker_runtime_settings',
			'SELECT,INSERT,UPDATE,DELETE'
		)
		and not has_table_privilege(
			'authenticated',
			'public.media_worker_dispatches',
			'SELECT,INSERT,UPDATE,DELETE'
		),
	'scheduler tables remain service-role-only'
);
select ok(
	has_function_privilege(
		'service_role',
		'public.dispatch_due_media_enrichment_workers()',
		'EXECUTE'
	)
		and has_function_privilege(
			'service_role',
			'public.reconcile_media_worker_dispatches()',
			'EXECUTE'
		)
		and not has_function_privilege(
			'authenticated',
			'public.dispatch_due_media_enrichment_workers()',
			'EXECUTE'
		),
	'media scheduler RPCs remain service-role-only'
);
select throws_ok(
	$$
		insert into public.media_worker_dispatches (
			scheduled_for,
			provider
		)
		values ('2026-07-30 00:00:00+00', 'imgur')
	$$,
	'23514',
	null,
	'Imgur dispatch audit cannot be created'
);

select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-dispatch-media-workers'
			and schedule = '* * * * *'
	),
	1::bigint,
	'YouTube media dispatcher keeps a separate one-minute Cron job'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-reconcile-media-worker-dispatches'
			and schedule = '* * * * *'
	),
	1::bigint,
	'YouTube pg_net reconciler keeps a separate one-minute Cron job'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-clean-media-worker-dispatches'
			and schedule = '50 18 * * *'
	),
	1::bigint,
	'YouTube dispatch cleanup keeps its daily Cron job'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-dispatch-due-crawl-sources'
			and schedule = '*/5 * * * *'
	),
	1::bigint,
	'existing crawl scheduler remains independently scheduled'
);

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'status',
	'disabled',
	'disabled media scheduler creates no external request'
);
reset role;

insert into public.threads (type, url, title, host, state)
values (
	'youtube',
	'https://www.youtube.com/watch?v=scheduler01',
	'Scheduler YouTube fixture',
	'youtube.com',
	'inbox'
);
insert into public.thread_media_metadata (thread_id, provider)
select id, 'youtube'
from public.threads
where url = 'https://www.youtube.com/watch?v=scheduler01';
insert into public.media_enrichment_jobs (thread_id, provider, available_at)
select id, 'youtube', now() - interval '1 minute'
from public.threads
where url = 'https://www.youtube.com/watch?v=scheduler01';

delete from vault.secrets
where name in ('crawl_app_base_url', 'crawl_internal_secret');
update public.crawl_runtime_settings
set scheduler_enabled = true
where id = true;
update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = true
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'status',
	'configuration-missing',
	'missing shared Vault configuration fails closed'
);
reset role;
select is(
	(
		select scheduler_enabled
		from public.media_worker_runtime_settings
		where id = true
	),
	false,
	'missing Vault configuration disables only the media scheduler'
);
select is(
	(
		select scheduler_enabled
		from public.crawl_runtime_settings
		where id = true
	),
	true,
	'media configuration failure never disables the crawl scheduler'
);

select vault.create_secret(
	'https://youtube-worker.invalid',
	'crawl_app_base_url',
	'YouTube worker pgTAP fixture'
);
select vault.create_secret(
	'youtube-worker-secret-12345678901234567890',
	'crawl_internal_secret',
	'YouTube worker pgTAP fixture'
);
update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = true
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers(),
	jsonb_build_object('status', 'dispatched', 'dispatchedCount', 1),
	'due YouTube work creates one dispatch'
);
select is(
	public.dispatch_due_media_enrichment_workers(),
	jsonb_build_object('status', 'idle', 'dispatchedCount', 0),
	'unresolved YouTube dispatch prevents overlap'
);
reset role;
select is(
	(
		select count(*)
		from public.media_worker_dispatches
		where provider = 'youtube'
			and state = 'queued'
	),
	1::bigint,
	'only one queued YouTube dispatch audit exists'
);
select is(
	(
		select request.url
		from net.http_request_queue as request
		where request.url like 'https://youtube-worker.invalid/api/media/%'
		order by request.id desc
		limit 1
	),
	'https://youtube-worker.invalid/api/media/youtube/enrich',
	'pg_net calls only the internal YouTube worker endpoint'
);
select is(
	(
		select convert_from(request.body, 'UTF8')::jsonb ->> 'limit'
		from net.http_request_queue as request
		where request.url = 'https://youtube-worker.invalid/api/media/youtube/enrich'
		order by request.id desc
		limit 1
	),
	(
		select youtube_batch_size::text
		from public.media_worker_runtime_settings
		where id = true
	),
	'pg_net uses the configured YouTube batch size'
);
select is(
	(
		select count(*)
		from net.http_request_queue
		where url like '%/api/media/imgur/%'
	),
	0::bigint,
	'no Imgur endpoint request is queued'
);
select ok(
	not exists (
		select 1
		from public.media_worker_dispatches as dispatch
		where to_jsonb(dispatch)::text like '%youtube-worker-secret%'
	),
	'dispatch audit never persists the internal secret'
);

delete from public.media_worker_dispatches;
update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = false
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers(),
	jsonb_build_object('status', 'idle', 'dispatchedCount', 0),
	'disabled YouTube switch leaves the global media scheduler available'
);
reset role;

insert into public.media_worker_dispatches (
	scheduled_for,
	provider,
	request_id,
	created_at
)
values
	('2026-07-30 00:01:00+00', 'youtube', 970001, now()),
	('2026-07-30 00:02:00+00', 'youtube', 970002, now()),
	('2026-07-30 00:03:00+00', 'youtube', 970003, now()),
	('2026-07-30 00:04:00+00', 'youtube', 970004, now()),
	('2026-07-30 00:05:00+00', 'youtube', 970005, now()),
	('2026-07-30 00:06:00+00', 'youtube', 970006, now()),
	('2026-07-30 00:07:00+00', 'youtube', 970007, now());

insert into net._http_response (
	id,
	status_code,
	content_type,
	headers,
	content,
	timed_out,
	error_msg
)
values
	(
		970001,
		200,
		'application/json',
		'{}'::jsonb,
		'{
			"claimedCount":2,
			"readyCount":1,
			"unavailableCount":0,
			"unsupportedCount":0,
			"retriedCount":1,
			"failedCount":0,
			"leaseRejectedCount":0
		}',
		false,
		null
	),
	(970002, 401, 'application/json', '{}'::jsonb, '{"reason":"invalid-secret"}', false, null),
	(970003, 403, 'application/json', '{}'::jsonb, '{}', false, null),
	(970004, 404, 'application/json', '{}'::jsonb, '{}', false, null),
	(970005, 429, 'application/json', '{}'::jsonb, '{}', false, null),
	(
		970006,
		503,
		'application/json',
		'{}'::jsonb,
		'{"reason":"configuration-missing"}',
		false,
		null
	),
	(970007, null, null, '{}'::jsonb, null, true, 'timeout');

update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = true
where id = true;

set local role service_role;
select is(
	public.reconcile_media_worker_dispatches(),
	7::bigint,
	'reconciler settles all YouTube HTTP and transport results'
);
reset role;
select is(
	(
		select jsonb_object_agg(request_id::text, state)
		from public.media_worker_dispatches
		where request_id between 970001 and 970007
	),
	'{
		"970001":"succeeded",
		"970002":"authentication-error",
		"970003":"authorization-error",
		"970004":"endpoint-not-found",
		"970005":"rate-limited",
		"970006":"server-error",
		"970007":"transport-error"
	}'::jsonb,
	'YouTube dispatch states distinguish success, auth, 404, 429, 5xx, and transport errors'
);
select is(
	(
		select row(claimed_count, ready_count, retried_count, failed_count)
		from public.media_worker_dispatches
		where request_id = 970001
	),
	row(2, 1, 1, 0),
	'reconciler stores only normalized YouTube worker counters'
);
select is(
	(
		select response_reason
		from public.media_worker_dispatches
		where request_id = 970006
	),
	'configuration-missing',
	'configuration reason remains visible without raw response persistence'
);
select is(
	(
		select row(scheduler_enabled, youtube_enabled)
		from public.media_worker_runtime_settings
		where id = true
	),
	row(true, false),
	'YouTube route configuration failure disables only the YouTube switch'
);
select is(
	(
		select scheduler_enabled
		from public.crawl_runtime_settings
		where id = true
	),
	true,
	'YouTube worker errors never disable the crawl scheduler'
);

insert into public.media_worker_dispatches (
	scheduled_for,
	provider,
	request_id,
	state,
	created_at,
	resolved_at
)
values
	(
		'2026-06-01 00:00:00+00',
		'youtube',
		979001,
		'succeeded',
		now() - interval '31 days',
		now() - interval '31 days'
	),
	(
		'2026-07-30 00:08:00+00',
		'youtube',
		979002,
		'succeeded',
		now(),
		now()
	);

select is(
	public.cleanup_media_worker_dispatches(),
	1::bigint,
	'dispatch cleanup removes YouTube audits older than 30 days'
);
select is(
	(
		select count(*)
		from public.media_worker_dispatches
		where request_id = 979002
	),
	1::bigint,
	'dispatch cleanup preserves recent YouTube audit'
);

select * from finish();

rollback;
