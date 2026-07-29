-- Media-only Cron, pg_net dispatch audit, fail-closed settings, and recovery contract.
begin;

select no_plan();

select has_table(
	'public',
	'media_worker_runtime_settings',
	'media worker runtime singleton exists'
);
select has_table(
	'public',
	'media_worker_dispatches',
	'media worker dispatch audit table exists'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'scheduler_enabled',
	'media scheduler has an independent cutover switch'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'youtube_enabled',
	'YouTube dispatch has an independent provider switch'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'imgur_enabled',
	'Imgur dispatch has an independent provider switch'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'imgur_cooldown_until',
	'Imgur runtime settings store provider cooldown'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'imgur_last_rate_limit_at',
	'Imgur runtime settings store the last rate-limit observation time'
);
select has_column(
	'public',
	'media_worker_dispatches',
	'response_reason',
	'dispatch audit stores a safe normalized response reason'
);
select has_column(
	'public',
	'media_worker_dispatches',
	'provider_outcome',
	'dispatch audit separates provider outcome from transport state'
);
select has_column(
	'public',
	'media_worker_dispatches',
	'provider_error_counts',
	'dispatch audit stores bounded safe provider error counts'
);
select has_column(
	'public',
	'media_worker_dispatches',
	'provider_http_status_counts',
	'dispatch audit stores bounded provider HTTP status counts'
);
select is(
	(
		select array_agg(conname::text order by conname)
		from pg_constraint
		where conrelid = 'public.media_worker_dispatches'::regclass
			and conname in (
				'media_worker_dispatches_provider_check',
				'media_worker_dispatches_state_check',
				'media_worker_dispatches_http_status_check',
				'media_worker_dispatches_response_reason_check',
				'media_worker_dispatches_counts_check',
				'media_worker_dispatches_provider_outcome_check',
				'media_worker_dispatches_provider_diagnostic_counts_check',
				'media_worker_dispatches_provider_error_counts_check',
				'media_worker_dispatches_provider_http_status_counts_check',
				'media_worker_dispatches_unique_bucket_provider'
			)
	),
	array[
		'media_worker_dispatches_counts_check',
		'media_worker_dispatches_http_status_check',
		'media_worker_dispatches_provider_check',
		'media_worker_dispatches_provider_diagnostic_counts_check',
		'media_worker_dispatches_provider_error_counts_check',
		'media_worker_dispatches_provider_http_status_counts_check',
		'media_worker_dispatches_provider_outcome_check',
		'media_worker_dispatches_response_reason_check',
		'media_worker_dispatches_state_check',
		'media_worker_dispatches_unique_bucket_provider'
	]::text[],
	'dispatch audit has bounded provider, state, status, reason, count, and uniqueness constraints'
);
select is(
	(
		select count(*)
		from pg_class
		where oid in (
			'public.media_worker_runtime_settings'::regclass,
			'public.media_worker_dispatches'::regclass
		)
			and relrowsecurity
	),
	2::bigint,
	'new public tables explicitly enable RLS'
);
select is(
	(
		select count(*)
		from pg_policy
		where polrelid in (
			'public.media_worker_runtime_settings'::regclass,
			'public.media_worker_dispatches'::regclass
		)
			and polroles = array['service_role'::regrole::oid]
	),
	2::bigint,
	'new scheduler tables declare service-role-only RLS policies'
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
			'SELECT'
		)
		and not has_table_privilege(
			'authenticated',
			'public.media_worker_dispatches',
			'SELECT'
		),
	'only service role receives explicit media scheduler table grants'
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
		)
		and has_function_privilege(
			'service_role',
			'public.set_imgur_enrichment_cooldown(timestamp with time zone,text)',
			'EXECUTE'
		)
		and not has_function_privilege(
			'authenticated',
			'public.set_imgur_enrichment_cooldown(timestamp with time zone,text)',
			'EXECUTE'
		),
	'media scheduler and cooldown RPCs are restricted to service role'
);
set local role service_role;
select lives_ok(
	$$
		insert into public.media_worker_dispatches (
			scheduled_for,
			provider,
			provider_error_counts,
			provider_http_status_counts
		)
		values (
			'2026-07-26 23:59:00+00',
			'imgur',
			'{"IMGUR_HTTP_429":1}'::jsonb,
			'{"429":1}'::jsonb
		)
	$$,
	'service role can write bounded dispatch diagnostics through table constraints'
);
reset role;
delete from public.media_worker_dispatches
where scheduled_for = '2026-07-26 23:59:00+00';
select is(
	(
		select row(
			scheduler_enabled,
			youtube_enabled,
			imgur_enabled,
			youtube_batch_size,
			imgur_batch_size
		)
		from public.media_worker_runtime_settings
		where id = true
	),
	row(false, true, false, 50, 1),
	'media scheduler keeps YouTube available while Imgur recovery starts disabled at batch one'
);
select throws_ok(
	$$
		update public.media_worker_runtime_settings
		set imgur_batch_size = 3
		where id = true
	$$,
	23514,
	null,
	'Imgur batch setting cannot exceed two sequential jobs'
);
select throws_ok(
	$$
		insert into public.media_worker_dispatches (
			scheduled_for,
			provider,
			provider_error_counts
		)
		select
			'2026-07-27 00:00:00+00',
			'imgur',
			jsonb_object_agg('IMGUR_ERROR_' || value, 1)
		from generate_series(1, 17) as value
	$$,
	23514,
	null,
	'dispatch diagnostics reject more than 16 aggregate keys'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-dispatch-media-workers'
			and schedule = '* * * * *'
	),
	1::bigint,
	'media dispatcher has a separate one-minute Cron job'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-reconcile-media-worker-dispatches'
			and schedule = '* * * * *'
	),
	1::bigint,
	'media pg_net reconciler has a separate one-minute Cron job'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-clean-media-worker-dispatches'
			and schedule = '50 18 * * *'
	),
	1::bigint,
	'media dispatch audit cleanup has a separate daily Cron job'
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
	'disabled media scheduler exits before reading Vault or dispatching'
);
reset role;
select is(
	(select count(*) from public.media_worker_dispatches),
	0::bigint,
	'disabled media scheduler creates no dispatch audit'
);

delete from vault.secrets
where name in ('crawl_app_base_url', 'crawl_internal_secret');

update public.crawl_runtime_settings
set scheduler_enabled = true
where id = true;
update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = true,
	imgur_enabled = true,
	imgur_cooldown_until = null,
	imgur_cooldown_reason = null
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'status',
	'configuration-missing',
	'missing shared Vault configuration fails closed without dispatch'
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
	'media scheduler configuration failure does not disable crawl scheduling'
);

delete from vault.secrets
where name in ('crawl_app_base_url', 'crawl_internal_secret');
select vault.create_secret(
	'https://phase6-media-worker.invalid',
	'crawl_app_base_url',
	'Phase 6 local pgTAP fixture'
);
select vault.create_secret(
	'phase6-local-secret-12345678901234567890',
	'crawl_internal_secret',
	'Phase 6 local pgTAP fixture'
);

update public.media_enrichment_jobs
set
	state = 'succeeded',
	lease_token = null,
	lease_expires_at = null
where state <> 'succeeded';

insert into public.threads (type, url, title, host, state)
values
	(
		'youtube',
		'https://www.youtube.com/watch?v=phase6worker',
		'Phase 6 YouTube',
		'youtube.com',
		'inbox'
	),
	(
		'imgur',
		'https://imgur.com/a/phase6worker',
		'Phase 6 Imgur',
		'imgur.com',
		'inbox'
	);
insert into public.thread_media_metadata (thread_id, provider)
select id, type
from public.threads
where url in (
	'https://www.youtube.com/watch?v=phase6worker',
	'https://imgur.com/a/phase6worker'
);
insert into public.media_enrichment_jobs (thread_id, provider, available_at)
select id, type, now() - interval '1 minute'
from public.threads
where url in (
	'https://www.youtube.com/watch?v=phase6worker',
	'https://imgur.com/a/phase6worker'
);

update public.media_worker_runtime_settings
set scheduler_enabled = true
where id = true;

create temporary table phase6_dispatch_result as
select public.dispatch_due_media_enrichment_workers() as value;

select is(
	(select value ->> 'dispatchedCount' from phase6_dispatch_result),
	'2',
	'one dispatch is created for each provider with available work'
);
select is(
	(
		select array_agg(provider order by provider)
		from public.media_worker_dispatches
		where state = 'queued'
	),
	array['imgur', 'youtube']::text[],
	'provider dispatch audits are distinct'
);
select is(
	(
		select array_agg(request.url order by request.url)
		from net.http_request_queue as request
		where request.url like 'https://phase6-media-worker.invalid/api/media/%'
	),
	array[
		'https://phase6-media-worker.invalid/api/media/imgur/enrich',
		'https://phase6-media-worker.invalid/api/media/youtube/enrich'
	]::text[],
	'pg_net targets only the two internal media worker endpoints'
);
select is(
	(
		select jsonb_object_agg(
			case
				when request.url like '%/youtube/%' then 'youtube'
				else 'imgur'
			end,
			convert_from(request.body, 'UTF8')::jsonb -> 'limit'
		)
		from net.http_request_queue as request
		where request.url like 'https://phase6-media-worker.invalid/api/media/%'
	),
	'{"youtube":50,"imgur":1}'::jsonb,
	'pg_net bodies use the bounded provider batch sizes'
);
select ok(
	not exists (
		select 1
		from public.media_worker_dispatches as dispatch
		where to_jsonb(dispatch)::text like '%phase6-local-secret%'
	),
	'dispatch audit never persists the shared internal secret'
);
set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'status',
	'idle',
	'unresolved provider dispatches prevent duplicate minute overlap'
);
reset role;
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url in (
			'https://www.youtube.com/watch?v=phase6worker',
			'https://imgur.com/a/phase6worker'
		)
			and job.state = 'queued'
	),
	2::bigint,
	'dispatch failure before claim leaves durable jobs available'
);

delete from public.media_worker_dispatches;
update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = true,
	imgur_enabled = false
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'dispatchedCount',
	'1',
	'YouTube-only mode dispatches one enabled provider'
);
reset role;
select is(
	(
		select array_agg(provider order by provider)
		from public.media_worker_dispatches
		where state = 'queued'
	),
	array['youtube']::text[],
	'disabled Imgur keeps its queued job without dispatching its endpoint'
);

delete from public.media_worker_dispatches;
update public.media_worker_runtime_settings
set
	youtube_enabled = true,
	imgur_enabled = true,
	imgur_cooldown_until = clock_timestamp() + interval '10 minutes',
	imgur_cooldown_reason = 'IMGUR_HTTP_429'
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'dispatchedCount',
	'1',
	'active Imgur cooldown skips only Imgur dispatch'
);
reset role;
select is(
	(
		select array_agg(provider order by provider)
		from public.media_worker_dispatches
		where state = 'queued'
	),
	array['youtube']::text[],
	'Imgur cooldown does not interrupt YouTube scheduler work'
);

delete from public.media_worker_dispatches;
update public.media_worker_runtime_settings
set
	imgur_cooldown_until = clock_timestamp() - interval '1 second',
	imgur_cooldown_reason = 'IMGUR_HTTP_429'
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'dispatchedCount',
	'2',
	'expired Imgur cooldown resumes provider dispatch automatically'
);
reset role;

delete from public.media_worker_dispatches;
insert into public.media_worker_dispatches (
	scheduled_for,
	provider,
	request_id,
	created_at
)
values
	('2026-07-27 00:01:00+00', 'youtube', 960001, now()),
	('2026-07-27 00:02:00+00', 'youtube', 960002, now()),
	('2026-07-27 00:03:00+00', 'youtube', 960003, now()),
	('2026-07-27 00:04:00+00', 'youtube', 960004, now()),
	('2026-07-27 00:05:00+00', 'youtube', 960005, now()),
	('2026-07-27 00:06:00+00', 'youtube', 960006, now()),
	('2026-07-27 00:07:00+00', 'youtube', 960007, now());

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
		960001,
		200,
		'application/json',
		'{}'::jsonb,
		'{"claimedCount":2,"readyCount":1,"retriedCount":1,"failedCount":0}'::text,
		false,
		null
	),
	(960002, 401, 'application/json', '{}'::jsonb, '{"reason":"invalid-secret"}', false, null),
	(960003, 403, 'application/json', '{}'::jsonb, '{}', false, null),
	(960004, 404, 'application/json', '{}'::jsonb, '{}', false, null),
	(960005, 429, 'application/json', '{}'::jsonb, '{}', false, null),
	(
		960006,
		503,
		'application/json',
		'{}'::jsonb,
		'{"reason":"configuration-missing"}',
		false,
		null
	),
	(960007, null, null, '{}'::jsonb, null, true, 'timeout');

update public.media_worker_runtime_settings
set scheduler_enabled = true
where id = true;

set local role service_role;
select is(
	public.reconcile_media_worker_dispatches(),
	7::bigint,
	'reconciler settles all available HTTP and transport results'
);
reset role;
select is(
	(
		select jsonb_object_agg(request_id::text, state)
		from public.media_worker_dispatches
		where request_id between 960001 and 960007
	),
	'{
		"960001":"succeeded",
		"960002":"authentication-error",
		"960003":"authorization-error",
		"960004":"endpoint-not-found",
		"960005":"rate-limited",
		"960006":"server-error",
		"960007":"transport-error"
	}'::jsonb,
	'401, 403, 404, 429, 5xx, transport, and success remain operationally distinct'
);
select is(
	(
		select row(claimed_count, ready_count, retried_count, failed_count)
		from public.media_worker_dispatches
		where request_id = 960001
	),
	row(2, 1, 1, 0),
	'reconciler persists only normalized worker result counts'
);
select is(
	(
		select row(provider_outcome, api_request_count, provider_error_counts)
		from public.media_worker_dispatches
		where request_id = 960001
	),
	row(null::text, null::integer, null::jsonb),
	'legacy YouTube worker responses remain valid without Imgur diagnostics'
);
select is(
	(
		select response_reason
		from public.media_worker_dispatches
		where request_id = 960006
	),
	'configuration-missing',
	'configuration failure reason remains visible without a raw response body'
);
select is(
	(
		select scheduler_enabled
		from public.media_worker_runtime_settings
		where id = true
	),
	true,
	'provider route failures do not disable the global media scheduler'
);
select is(
	(
		select row(youtube_enabled, imgur_enabled)
		from public.media_worker_runtime_settings
		where id = true
	),
	row(false, true),
	'YouTube route failures disable only the affected provider switch'
);
select is(
	(
		select scheduler_enabled
		from public.crawl_runtime_settings
		where id = true
	),
	true,
	'media response failures never disable the existing crawl scheduler'
);

insert into public.media_worker_dispatches (
	scheduled_for,
	provider,
	request_id,
	created_at
)
values (
	'2026-07-27 00:10:00+00',
	'imgur',
	960010,
	now()
);
insert into net._http_response (
	id,
	status_code,
	content_type,
	headers,
	content,
	timed_out,
	error_msg
)
values (
	960010,
	200,
	'application/json',
	'{}'::jsonb,
	'{
		"claimedCount":2,
		"readyCount":0,
		"unavailableCount":0,
		"unsupportedCount":0,
		"retriedCount":2,
		"failedCount":0,
		"leaseRejectedCount":0,
		"diagnostics":{
			"providerOutcome":"rate-limited",
			"apiRequestCount":1,
			"rateLimitedCount":2,
			"errorCounts":{"IMGUR_HTTP_429":2},
			"httpStatusCounts":{"429":1},
			"nextAvailableAt":"2026-07-27T01:10:00.000Z",
			"cooldownUntil":"2026-07-27T01:10:00.000Z",
			"rateLimit":{
				"clientRemaining":0,
				"userRemaining":4,
				"userResetAt":"2026-07-27T01:05:00.000Z"
			}
		}
	}',
	false,
	null
);

set local role service_role;
select is(
	public.reconcile_media_worker_dispatches(),
	1::bigint,
	'reconciler stores a successful transport with provider rate limiting'
);
reset role;
select is(
	(
		select row(
			state,
			provider_outcome,
			api_request_count,
			rate_limited_count,
			provider_error_counts,
			provider_http_status_counts,
			rate_limit_client_remaining
		)
		from public.media_worker_dispatches
		where request_id = 960010
	),
	row(
		'succeeded'::text,
		'rate-limited'::text,
		1,
		2,
		'{"IMGUR_HTTP_429":2}'::jsonb,
		'{"429":1}'::jsonb,
		0
	),
	'HTTP 200 transport remains succeeded while Imgur outcome and bounded diagnostics stay visible'
);
select is(
	(
		select scheduler_enabled
		from public.media_worker_runtime_settings
		where id = true
	),
	true,
	'provider rate limiting does not disable the global media scheduler'
);

insert into public.media_worker_dispatches (
	scheduled_for,
	provider,
	request_id,
	created_at
)
values (
	'2026-07-27 00:09:00+00',
	'imgur',
	960009,
	now()
);
insert into net._http_response (
	id,
	status_code,
	content_type,
	headers,
	content,
	timed_out,
	error_msg
)
values (
	960009,
	503,
	'application/json',
	'{}'::jsonb,
	'{"reason":"configuration-missing"}',
	false,
	null
);
update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = true,
	imgur_enabled = true
where id = true;

set local role service_role;
select is(
	public.reconcile_media_worker_dispatches(),
	1::bigint,
	'reconciler settles an Imgur provider configuration failure'
);
reset role;
select is(
	(
		select row(state, response_reason)
		from public.media_worker_dispatches
		where request_id = 960009
	),
	row('server-error'::text, 'configuration-missing'::text),
	'provider configuration failure remains visible in the dispatch audit'
);
select is(
	(
		select row(scheduler_enabled, youtube_enabled, imgur_enabled)
		from public.media_worker_runtime_settings
		where id = true
	),
	row(true, true, false),
	'Imgur configuration failure disables only Imgur and leaves YouTube scheduled'
);

insert into public.media_worker_dispatches (
	scheduled_for,
	provider,
	request_id,
	created_at
)
values (
	'2026-07-27 00:08:00+00',
	'imgur',
	960008,
	now() - interval '3 minutes'
);
set local role service_role;
select is(
	public.reconcile_media_worker_dispatches(),
	1::bigint,
	'missing pg_net response expires and can be dispatched again'
);
reset role;
select is(
	(
		select state
		from public.media_worker_dispatches
		where request_id = 960008
	),
	'expired',
	'expired dispatch audit does not consume or mutate a durable media job'
);

delete from public.media_worker_dispatches;
update public.media_enrichment_jobs as job
set
	state = case when job.provider = 'youtube' then 'processing' else 'succeeded' end,
	lease_token = case when job.provider = 'youtube' then gen_random_uuid() else null end,
	lease_expires_at = case
		when job.provider = 'youtube' then now() - interval '1 second'
		else null
	end
from public.threads as thread
where thread.id = job.thread_id
	and thread.url in (
		'https://www.youtube.com/watch?v=phase6worker',
		'https://imgur.com/a/phase6worker'
	);
update public.media_worker_runtime_settings
set scheduler_enabled = true
where id = true;

set local role service_role;
select is(
	public.dispatch_due_media_enrichment_workers() ->> 'dispatchedCount',
	'1',
	'expired processing lease makes its provider dispatchable again'
);
reset role;
select is(
	(
		select provider
		from public.media_worker_dispatches
		order by id desc
		limit 1
	),
	'youtube',
	'lease recovery dispatch remains provider-specific'
);

delete from public.media_worker_dispatches;
insert into public.media_worker_dispatches (
	scheduled_for,
	provider,
	state,
	created_at,
	resolved_at
)
values
	(
		'2026-05-01 00:00:00+00',
		'imgur',
		'succeeded',
		clock_timestamp() - interval '31 days',
		clock_timestamp() - interval '31 days'
	),
	(
		'2026-07-29 00:00:00+00',
		'youtube',
		'succeeded',
		clock_timestamp() - interval '29 days',
		clock_timestamp() - interval '29 days'
	);
select is(
	public.cleanup_media_worker_dispatches(),
	1::bigint,
	'dispatch cleanup removes only aggregate diagnostics older than 30 days'
);
select is(
	(select count(*) from public.media_worker_dispatches),
	1::bigint,
	'30-day cleanup preserves recent dispatch diagnostics'
);

select * from finish();
rollback;
