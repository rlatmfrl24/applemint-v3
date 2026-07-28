-- YouTube and Imgur metadata summary, durable queue, and list contract.
begin;

select no_plan();

select has_table(
	'public',
	'thread_media_metadata',
	'thread media metadata summary table exists'
);
select has_table(
	'public',
	'media_enrichment_jobs',
	'media enrichment durable queue table exists'
);
select has_column(
	'public',
	'media_worker_runtime_settings',
	'imgur_enrichment_cutoff_at',
	'Imgur enrichment cutover is recorded in runtime settings'
);
select ok(
	(
		select imgur_enrichment_cutoff_at <= clock_timestamp()
		from public.media_worker_runtime_settings
		where id = true
	),
	'Imgur enrichment cutover has a valid timestamp'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.thread_media_metadata'::regclass
			and contype = 'p'
			and conkey = array[
				(
					select attnum
					from pg_attribute
					where attrelid = 'public.thread_media_metadata'::regclass
						and attname = 'thread_id'
				)
			]::smallint[]
	),
	'metadata thread_id is the primary key'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.thread_media_metadata'::regclass
			and contype = 'f'
			and confrelid = 'public.threads'::regclass
			and confdeltype = 'c'
	),
	'metadata references threads with ON DELETE CASCADE'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.media_enrichment_jobs'::regclass
			and contype = 'f'
			and confrelid = 'public.thread_media_metadata'::regclass
			and confdeltype = 'c'
	),
	'jobs reference metadata with ON DELETE CASCADE'
);
select ok(
	not exists (
		select required.constraint_name
		from unnest(array[
			'thread_media_metadata_provider_check',
			'thread_media_metadata_status_check',
			'thread_media_metadata_media_kind_check',
			'thread_media_metadata_duration_check',
			'thread_media_metadata_media_count_check',
			'thread_media_metadata_preview_count_check',
			'media_enrichment_jobs_provider_check',
			'media_enrichment_jobs_state_check',
			'media_enrichment_jobs_attempt_count_check',
			'media_enrichment_jobs_lease_check'
		]) as required(constraint_name)
		where not exists (
			select 1
			from pg_constraint
			where conname = required.constraint_name
				and connamespace = 'public'::regnamespace
				and contype = 'c'
		)
	),
	'metadata and job allow-list, count, and lease checks exist'
);
select has_index(
	'public',
	'media_enrichment_jobs',
	'media_enrichment_jobs_available_idx',
	'available queue work has a partial covering index'
);
select has_index(
	'public',
	'media_enrichment_jobs',
	'media_enrichment_jobs_expired_lease_idx',
	'expired leases have a partial covering index'
);
select ok(
	exists (
		select 1
		from pg_trigger
		where tgrelid = 'public.threads'::regclass
			and tgname = 'cancel_active_media_enrichment_on_trash'
			and not tgisinternal
	),
	'threads has an active media cancellation trigger'
);
select ok(
	exists (
		select 1
		from pg_proc
		where oid = 'private.cancel_active_media_enrichment_on_trash()'::regprocedure
			and not prosecdef
	),
	'Trash cancellation trigger uses security invoker'
);
select ok(
	(
		select relrowsecurity
		from pg_class
		where oid = 'public.thread_media_metadata'::regclass
	)
	and (
		select relrowsecurity
		from pg_class
		where oid = 'public.media_enrichment_jobs'::regclass
	),
	'RLS is enabled on both public media tables'
);
select ok(
	exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'thread_media_metadata'
			and cmd = 'SELECT'
			and roles = array['authenticated']::name[]
	),
	'metadata has an authenticated owner read policy'
);
select ok(
	has_table_privilege('authenticated', 'public.thread_media_metadata', 'SELECT')
		and not has_table_privilege(
			'authenticated',
			'public.thread_media_metadata',
			'INSERT,UPDATE,DELETE'
		),
	'authenticated can only select metadata before RLS'
);
select ok(
	not has_table_privilege(
		'authenticated',
		'public.media_enrichment_jobs',
		'SELECT,INSERT,UPDATE,DELETE'
	),
	'authenticated has no direct job access'
);
select ok(
	has_table_privilege(
		'service_role',
		'public.thread_media_metadata',
		'SELECT,INSERT,UPDATE,DELETE'
	)
		and has_table_privilege(
			'service_role',
			'public.media_enrichment_jobs',
			'SELECT,INSERT,UPDATE,DELETE'
		),
	'service role can manage metadata and jobs'
);
select ok(
	has_function_privilege(
		'service_role',
		'public.claim_media_enrichment_jobs(text,integer,integer)',
		'EXECUTE'
	)
		and has_function_privilege(
			'service_role',
			'public.complete_media_enrichment_job(bigint,uuid,jsonb)',
			'EXECUTE'
		)
		and has_function_privilege(
			'service_role',
			'public.retry_media_enrichment_job(bigint,uuid,text,timestamp with time zone)',
			'EXECUTE'
		)
		and has_function_privilege(
			'service_role',
			'public.fail_media_enrichment_job(bigint,uuid,text)',
			'EXECUTE'
		),
	'service role can execute all queue lifecycle RPCs'
);
select ok(
	not has_function_privilege(
		'authenticated',
		'public.claim_media_enrichment_jobs(text,integer,integer)',
		'EXECUTE'
	)
		and not has_function_privilege(
			'authenticated',
			'public.complete_media_enrichment_job(bigint,uuid,jsonb)',
			'EXECUTE'
		)
		and not has_function_privilege(
			'authenticated',
			'public.retry_media_enrichment_job(bigint,uuid,text,timestamp with time zone)',
			'EXECUTE'
		)
		and not has_function_privilege(
			'authenticated',
			'public.fail_media_enrichment_job(bigint,uuid,text)',
			'EXECUTE'
		),
	'authenticated cannot execute queue lifecycle RPCs'
);
select is(
	(
		select count(*)
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'thread_media_metadata'
			and column_name in ('raw_payload', 'response_payload', 'api_payload')
	),
	0::bigint,
	'metadata schema has no raw provider payload column'
);

insert into public.threads (type, url, title, host, state)
values ('youtube', 'https://phase2-security.test/watch?v=owner', 'source title', 'youtube.com', 'inbox');
insert into public.thread_media_metadata (thread_id, provider)
select id, 'youtube'
from public.threads
where url = 'https://phase2-security.test/watch?v=owner';
insert into public.media_enrichment_jobs (thread_id, provider)
select id, 'youtube'
from public.threads
where url = 'https://phase2-security.test/watch?v=owner';

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
	(select count(*) from public.thread_media_metadata),
	0::bigint,
	'non-owner metadata reads are hidden by RLS'
);
select throws_ok(
	$$select count(*) from public.media_enrichment_jobs$$,
	'42501',
	null,
	'non-owner cannot read jobs directly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	(
		select count(*)
		from public.thread_media_metadata
		where thread_id = (
			select id
			from public.threads
			where url = 'https://phase2-security.test/watch?v=owner'
		)
	),
	1::bigint,
	'owner can read normalized metadata'
);
select throws_ok(
	$$select count(*) from public.media_enrichment_jobs$$,
	'42501',
	null,
	'owner cannot read jobs directly'
);
reset role;

insert into public.threads (
	type,
	url,
	title,
	host,
	state,
	created_at,
	captured_at,
	state_changed_at
)
select
	'imgur',
	'https://phase2-legacy.test/imgur',
	'legacy imgur',
	'imgur.com',
	'inbox',
	settings.imgur_enrichment_cutoff_at - interval '1 day',
	settings.imgur_enrichment_cutoff_at - interval '1 day',
	settings.imgur_enrichment_cutoff_at - interval '1 day'
from public.media_worker_runtime_settings as settings
where settings.id = true;
insert into public."crawl-history" (url, crawl_source, host)
values ('https://phase2-legacy.test/imgur', 'arcalive', 'imgur.com');

select is(
	public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://phase2-legacy.test/imgur","title":"duplicate","type":"imgur"}]'::jsonb
	),
	'{"insertedCount": 0, "skippedCount": 1}'::jsonb,
	're-crawling an existing Imgur thread does not treat it as newly collected'
);
select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url = 'https://phase2-legacy.test/imgur'
	),
	0::bigint,
	'existing Imgur thread has no preview metadata'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url = 'https://phase2-legacy.test/imgur'
	),
	0::bigint,
	'existing Imgur thread has no enrichment job'
);

select is(
	public.ingest_crawl_items(
		'arcalive',
		'[
			{"url":"https://phase2-ingest.test/youtube","title":"youtube","type":"youtube"},
			{"url":"https://phase2-ingest.test/imgur","title":"imgur","type":"imgur"},
			{"url":"https://phase2-ingest.test/normal","title":"normal","type":"normal"}
		]'::jsonb
	),
	'{"insertedCount": 3, "skippedCount": 0}'::jsonb,
	'ingest inserts provider and normal threads'
);
select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url like 'https://phase2-ingest.test/%'
	),
	2::bigint,
	'ingest atomically creates pending metadata for provider threads'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url like 'https://phase2-ingest.test/%'
			and job.state = 'queued'
	),
	2::bigint,
	'ingest atomically creates queued jobs for provider threads'
);
select ok(
	not exists (
		select 1
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		cross join public.media_worker_runtime_settings as settings
		where thread.url = 'https://phase2-ingest.test/imgur'
			and settings.id = true
			and (
				metadata.provider <> 'imgur'
				or metadata.created_at < settings.imgur_enrichment_cutoff_at
			)
	),
	'new Imgur ingest creates metadata on or after the cutover'
);
select is(
	public.ingest_crawl_items(
		'arcalive',
		'[
			{"url":"https://phase2-ingest.test/youtube","title":"duplicate","type":"youtube"},
			{"url":"https://phase2-ingest.test/imgur","title":"duplicate","type":"imgur"},
			{"url":"https://phase2-ingest.test/normal","title":"duplicate","type":"normal"}
		]'::jsonb
	),
	'{"insertedCount": 0, "skippedCount": 3}'::jsonb,
	'duplicate ingest creates no second thread, metadata, or job'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url like 'https://phase2-ingest.test/%'
	),
	2::bigint,
	'duplicate ingest leaves one current job per provider thread'
);

create function pg_temp.reject_phase2_imgur_job()
returns trigger
language plpgsql
as $$
begin
	if new.provider = 'imgur' then
		raise exception using errcode = 'P0001', message = 'forced phase2 job failure';
	end if;
	return new;
end;
$$;
create trigger reject_phase2_imgur_job
before insert on public.media_enrichment_jobs
for each row execute function pg_temp.reject_phase2_imgur_job();

select throws_ok(
	$$
		select public.ingest_crawl_items(
			'battlepage',
			'[
				{"url":"https://phase2-rollback.test/normal","type":"normal"},
				{"url":"https://phase2-rollback.test/youtube","type":"youtube"},
				{"url":"https://phase2-rollback.test/imgur","type":"imgur"}
			]'::jsonb
		)
	$$,
	'P0001',
	'forced phase2 job failure',
	'job creation failure aborts the entire ingest batch'
);
drop trigger reject_phase2_imgur_job on public.media_enrichment_jobs;

select is(
	(select count(*) from public.threads where url like 'https://phase2-rollback.test/%'),
	0::bigint,
	'failed ingest leaves no partial threads'
);
select is(
	(
		select count(*)
		from public."crawl-history"
		where url like 'https://phase2-rollback.test/%'
	),
	0::bigint,
	'failed ingest leaves no partial crawl history'
);
select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url like 'https://phase2-rollback.test/%'
	),
	0::bigint,
	'failed ingest leaves no partial metadata'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url like 'https://phase2-rollback.test/%'
	),
	0::bigint,
	'failed ingest leaves no partial jobs'
);

insert into public.threads (
	type,
	url,
	title,
	host,
	state,
	created_at,
	captured_at,
	state_changed_at
)
values
	(
		'youtube',
		'https://phase2-backfill.test/youtube',
		'backfill youtube',
		'youtube.com',
		'inbox',
		'2025-01-01 00:00:00+00',
		'2025-01-02 00:00:00+00',
		'2025-01-03 00:00:00+00'
	),
	(
		'imgur',
		'https://phase2-backfill.test/imgur',
		'backfill imgur',
		'imgur.com',
		'trash',
		'2025-02-01 00:00:00+00',
		'2025-02-02 00:00:00+00',
		'2025-02-03 00:00:00+00'
	);
insert into public."crawl-history" (url, crawl_source, host, created_at)
values
	('https://phase2-backfill.test/youtube', 'arcalive', 'youtube.com', '2025-01-04 00:00:00+00'),
	('https://phase2-backfill.test/imgur', 'battlepage', 'imgur.com', '2025-02-04 00:00:00+00');

create temporary table phase2_thread_snapshot as
select *
from public.threads
where url like 'https://phase2-backfill.test/%';
create temporary table phase2_history_snapshot as
select *
from public."crawl-history"
where url like 'https://phase2-backfill.test/%';

insert into public.thread_media_metadata (thread_id, provider, status)
select thread.id, thread.type, 'pending'
from public.threads as thread
cross join public.media_worker_runtime_settings as settings
where settings.id = true
	and (
		thread.type = 'youtube'
		or (
			thread.type = 'imgur'
			and thread.created_at >= settings.imgur_enrichment_cutoff_at
		)
	)
on conflict (thread_id) do nothing;
select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url like 'https://phase2-backfill.test/%'
	),
	1::bigint,
	'backfill excludes Imgur threads collected before cutover'
);

insert into public.media_enrichment_jobs (thread_id, provider, state)
select metadata.thread_id, metadata.provider, 'queued'
from public.thread_media_metadata as metadata
where metadata.status = 'pending'
on conflict (thread_id) do nothing;
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url like 'https://phase2-backfill.test/%'
	),
	1::bigint,
	'backfill creates a job only for eligible provider metadata'
);

create temporary table phase2_metadata_snapshot as
select metadata.*
from public.thread_media_metadata as metadata
inner join public.threads as thread on thread.id = metadata.thread_id
where thread.url like 'https://phase2-backfill.test/%';
create temporary table phase2_job_snapshot as
select job.*
from public.media_enrichment_jobs as job
inner join public.threads as thread on thread.id = job.thread_id
where thread.url like 'https://phase2-backfill.test/%';

insert into public.thread_media_metadata (thread_id, provider, status)
select thread.id, thread.type, 'pending'
from public.threads as thread
cross join public.media_worker_runtime_settings as settings
where settings.id = true
	and (
		thread.type = 'youtube'
		or (
			thread.type = 'imgur'
			and thread.created_at >= settings.imgur_enrichment_cutoff_at
		)
	)
on conflict (thread_id) do nothing;
insert into public.media_enrichment_jobs (thread_id, provider, state)
select metadata.thread_id, metadata.provider, 'queued'
from public.thread_media_metadata as metadata
where metadata.status = 'pending'
on conflict (thread_id) do nothing;

select is(
	(
		select jsonb_agg(to_jsonb(metadata) order by metadata.thread_id)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url like 'https://phase2-backfill.test/%'
	),
	(
		select jsonb_agg(to_jsonb(snapshot) order by snapshot.thread_id)
		from phase2_metadata_snapshot as snapshot
	),
	'metadata backfill is idempotent'
);
select is(
	(
		select jsonb_agg(to_jsonb(job) order by job.thread_id)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url like 'https://phase2-backfill.test/%'
	),
	(
		select jsonb_agg(to_jsonb(snapshot) order by snapshot.thread_id)
		from phase2_job_snapshot as snapshot
	),
	'job backfill is idempotent'
);
select is(
	(
		select jsonb_agg(to_jsonb(thread) order by thread.id)
		from public.threads as thread
		where thread.url like 'https://phase2-backfill.test/%'
	),
	(
		select jsonb_agg(to_jsonb(snapshot) order by snapshot.id)
		from phase2_thread_snapshot as snapshot
	),
	'backfill preserves state, content, and all thread timestamps'
);
select is(
	(
		select jsonb_agg(to_jsonb(history) order by history.id)
		from public."crawl-history" as history
		where history.url like 'https://phase2-backfill.test/%'
	),
	(
		select jsonb_agg(to_jsonb(snapshot) order by snapshot.id)
		from phase2_history_snapshot as snapshot
	),
	'backfill does not mutate crawl history'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	(
		select page.media_metadata ->> 'provider'
		from public.list_threads_page('inbox', 100, null, null, 'youtube') as page
		where page.url = 'https://phase2-backfill.test/youtube'
	),
	'youtube',
	'list RPC returns nullable metadata summary with the existing type filter'
);
select is(
	(
		select page.media_metadata
		from public.list_threads_page('inbox', 100, null, null, 'normal') as page
		where page.url = 'https://phase2-ingest.test/normal'
	),
	null::jsonb,
	'list RPC returns null metadata for a normal thread'
);
select is(
	(
		select page.media_metadata
		from public.list_threads_page('inbox', 100, null, null, 'imgur') as page
		where page.url = 'https://phase2-legacy.test/imgur'
	),
	null::jsonb,
	'list RPC returns null metadata for an Imgur thread collected before cutover'
);
select is(
	(select count(*) from public.list_threads_page('inbox', 1, null, null, 'youtube')),
	2::bigint,
	'list RPC keeps one-row look-ahead pagination'
);
select lives_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(
			select id
			from public.threads
			where url = 'https://phase2-backfill.test/youtube'
		),
		'inbox',
		'saved'
	),
	'provider thread state transition still succeeds'
);
select is(
	(
		select page.media_metadata ->> 'provider'
		from public.list_threads_page('saved', 100, null, null, 'youtube') as page
		where page.url = 'https://phase2-backfill.test/youtube'
	),
	'youtube',
	'state transition preserves media metadata in list responses'
);
reset role;

update public.media_enrichment_jobs
set state = 'succeeded'
where state <> 'succeeded';

insert into public.threads (type, url, title, host, state)
values
	('youtube', 'https://phase2-queue.test/complete', 'complete', 'youtube.com', 'inbox'),
	('youtube', 'https://phase2-queue.test/fail', 'fail', 'youtube.com', 'inbox'),
	('imgur', 'https://phase2-queue.test/reclaim', 'reclaim', 'imgur.com', 'inbox');
insert into public.thread_media_metadata (thread_id, provider)
select id, type
from public.threads
where url like 'https://phase2-queue.test/%';
insert into public.media_enrichment_jobs (
	thread_id,
	provider,
	available_at,
	created_at
)
select
	id,
	type,
	case
		when url = 'https://phase2-queue.test/fail' then '2100-01-01 00:00:00+00'::timestamptz
		else '2000-01-01 00:00:00+00'::timestamptz
	end,
	case
		when url = 'https://phase2-queue.test/complete' then '2000-01-01 00:00:00+00'::timestamptz
		when url = 'https://phase2-queue.test/reclaim' then '2000-01-02 00:00:00+00'::timestamptz
		else '2000-01-03 00:00:00+00'::timestamptz
	end
from public.threads
where url like 'https://phase2-queue.test/%';

create temporary table phase2_first_claim as
select *
from public.claim_media_enrichment_jobs('youtube', 1, 60);
select is(
	(select attempt_count from phase2_first_claim),
	1,
	'claim atomically increments attempt_count'
);
select is(
	(
		select url
		from phase2_first_claim
	),
	'https://phase2-queue.test/complete',
	'claim returns the thread URL needed by a worker'
);
select is(
	public.complete_media_enrichment_job(
		(select thread_id from phase2_first_claim),
		gen_random_uuid(),
		'{"status":"ready","media_kind":"video"}'::jsonb
	),
	false,
	'complete rejects a non-matching lease token'
);
select is(
	public.retry_media_enrichment_job(
		(select thread_id from phase2_first_claim),
		gen_random_uuid(),
		'HTTP_429',
		now()
	),
	false,
	'retry rejects a non-matching lease token'
);
select is(
	public.fail_media_enrichment_job(
		(select thread_id from phase2_first_claim),
		gen_random_uuid(),
		'NOT_FOUND'
	),
	false,
	'fail rejects a non-matching lease token'
);
select is(
	(
		select state
		from public.media_enrichment_jobs
		where thread_id = (select thread_id from phase2_first_claim)
	),
	'processing',
	'wrong tokens leave the processing job unchanged'
);
select is(
	public.retry_media_enrichment_job(
		(select thread_id from phase2_first_claim),
		(select lease_token from phase2_first_claim),
		'HTTP_429',
		now() - interval '1 second'
	),
	true,
	'matching lease token schedules a retry'
);
select is(
	(
		select state
		from public.media_enrichment_jobs
		where thread_id = (select thread_id from phase2_first_claim)
	),
	'retry',
	'retry clears the processing lease and records queue state'
);

create temporary table phase2_retry_claim as
select *
from public.claim_media_enrichment_jobs('youtube', 1, 60);
select is(
	(select attempt_count from phase2_retry_claim),
	2,
	'retry claim increments the cumulative attempt count'
);
select isnt(
	(select lease_token from phase2_retry_claim),
	(select lease_token from phase2_first_claim),
	'retry claim issues a new lease token'
);
select is(
	public.complete_media_enrichment_job(
		(select thread_id from phase2_retry_claim),
		(select lease_token from phase2_retry_claim),
		'{
			"status":"ready",
			"external_id":"video-1",
			"media_kind":"video",
			"title":"Official title",
			"channel_title":"Official channel",
			"thumbnail_url":"https://i.ytimg.com/vi/video-1/hqdefault.jpg",
			"duration_seconds":125,
			"live_status":"none",
			"preview_urls":["https://preview.test/1","https://preview.test/2"],
			"raw_payload":{"api_key":"must-not-persist"}
		}'::jsonb
	),
	true,
	'matching lease token completes normalized metadata atomically'
);
select is(
	(
		select status
		from public.thread_media_metadata
		where thread_id = (select thread_id from phase2_retry_claim)
	),
	'ready',
	'complete stores the normalized terminal metadata status'
);
select is(
	(
		select duration_seconds
		from public.thread_media_metadata
		where thread_id = (select thread_id from phase2_retry_claim)
	),
	125,
	'complete stores normalized YouTube duration'
);
select is(
	(
		select cardinality(preview_urls)
		from public.thread_media_metadata
		where thread_id = (select thread_id from phase2_retry_claim)
	),
	2,
	'complete stores only the bounded preview summary'
);
select ok(
	not (
		select to_jsonb(metadata) ? 'raw_payload'
		from public.thread_media_metadata as metadata
		where thread_id = (select thread_id from phase2_retry_claim)
	),
	'complete ignores unknown raw payload fields'
);
select is(
	(
		select state
		from public.media_enrichment_jobs
		where thread_id = (select thread_id from phase2_retry_claim)
	),
	'succeeded',
	'complete moves the job to succeeded and clears its lease'
);

update public.media_enrichment_jobs
set available_at = now() - interval '1 second'
where thread_id = (
	select id
	from public.threads
	where url = 'https://phase2-queue.test/fail'
);
create temporary table phase2_fail_claim as
select *
from public.claim_media_enrichment_jobs('youtube', 1, 60);
select is(
	public.fail_media_enrichment_job(
		(select thread_id from phase2_fail_claim),
		(select lease_token from phase2_fail_claim),
		'NOT_FOUND'
	),
	true,
	'matching lease token records a terminal failure'
);
select ok(
	(
		select metadata.status = 'failed'
			and metadata.last_error_code = 'NOT_FOUND'
			and job.state = 'dead'
			and job.last_error_code = 'NOT_FOUND'
		from public.thread_media_metadata as metadata
		inner join public.media_enrichment_jobs as job using (thread_id)
		where metadata.thread_id = (select thread_id from phase2_fail_claim)
	),
	'fail atomically updates metadata and job terminal state'
);

create temporary table phase2_expired_claim as
select *
from public.claim_media_enrichment_jobs('imgur', 1, 60);
update public.media_enrichment_jobs
set lease_expires_at = now() - interval '1 second'
where thread_id = (select thread_id from phase2_expired_claim);
create temporary table phase2_reclaim as
select *
from public.claim_media_enrichment_jobs('imgur', 1, 60);
select is(
	(select thread_id from phase2_reclaim),
	(select thread_id from phase2_expired_claim),
	'expired processing lease can be reclaimed'
);
select is(
	(select attempt_count from phase2_reclaim),
	2,
	'expired lease reclaim increments attempt_count'
);
select isnt(
	(select lease_token from phase2_reclaim),
	(select lease_token from phase2_expired_claim),
	'expired lease reclaim replaces the lease token'
);
select is(
	public.complete_media_enrichment_job(
		(select thread_id from phase2_expired_claim),
		(select lease_token from phase2_expired_claim),
		'{"status":"ready","media_kind":"image"}'::jsonb
	),
	false,
	'stale worker cannot complete after a lease is reclaimed'
);

select throws_ok(
	$$
		insert into public.thread_media_metadata (thread_id, provider, preview_urls)
		values (
			(select id from public.threads where url = 'https://phase2-ingest.test/normal'),
			'youtube',
			array['1', '2', '3', '4', '5']
		)
	$$,
	'23514',
	null,
	'metadata rejects more than four preview URLs'
);
select throws_ok(
	$$
		update public.thread_media_metadata
		set duration_seconds = -1
		where thread_id = (select thread_id from phase2_reclaim)
	$$,
	'23514',
	null,
	'metadata rejects negative duration'
);
select throws_ok(
	$$
		update public.media_enrichment_jobs
		set state = 'processing'
		where thread_id = (select thread_id from phase2_retry_claim)
	$$,
	'23514',
	null,
	'job rejects processing state without a complete lease'
);

update public.media_enrichment_jobs
set
	state = 'succeeded',
	lease_token = null,
	lease_expires_at = null
where state in ('queued', 'retry', 'processing');

insert into public.threads (type, url, title, host, state)
values
	(
		'imgur',
		'https://phase2-trash-cancel.test/single',
		'single cancellation',
		'imgur.com',
		'inbox'
	),
	(
		'imgur',
		'https://phase2-trash-cancel.test/saved',
		'saved cancellation',
		'imgur.com',
		'saved'
	),
	(
		'youtube',
		'https://phase2-trash-cancel.test/bulk',
		'bulk cancellation',
		'youtube.com',
		'inbox'
	),
	(
		'imgur',
		'https://phase2-trash-cancel.test/succeeded',
		'completed metadata',
		'imgur.com',
		'inbox'
	),
	(
		'imgur',
		'https://phase2-trash-cancel.test/claim-guard',
		'claim guard',
		'imgur.com',
		'trash'
	),
	(
		'imgur',
		'https://phase2-trash-cancel.test/existing',
		'existing trash thread',
		'imgur.com',
		'trash'
	);

insert into public."crawl-history" (url, crawl_source, host)
values ('https://phase2-trash-cancel.test/existing', 'arcalive', 'imgur.com');

insert into public.thread_media_metadata (thread_id, provider, status)
select
	thread.id,
	thread.type,
	case
		when thread.url = 'https://phase2-trash-cancel.test/succeeded' then 'ready'
		else 'pending'
	end
from public.threads as thread
where thread.url like 'https://phase2-trash-cancel.test/%'
	and thread.url <> 'https://phase2-trash-cancel.test/existing';

insert into public.media_enrichment_jobs (
	thread_id,
	provider,
	state,
	available_at,
	lease_token,
	lease_expires_at
)
select
	thread.id,
	thread.type,
	case
		when thread.url = 'https://phase2-trash-cancel.test/saved' then 'retry'
		when thread.url = 'https://phase2-trash-cancel.test/bulk' then 'processing'
		when thread.url = 'https://phase2-trash-cancel.test/succeeded' then 'succeeded'
		else 'queued'
	end,
	now() - interval '1 minute',
	case
		when thread.url = 'https://phase2-trash-cancel.test/bulk'
			then '00000000-0000-4000-8000-000000000901'::uuid
		else null
	end,
	case
		when thread.url = 'https://phase2-trash-cancel.test/bulk'
			then now() + interval '1 hour'
		else null
	end
from public.threads as thread
where thread.url like 'https://phase2-trash-cancel.test/%'
	and thread.url <> 'https://phase2-trash-cancel.test/existing';

select is(
	public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://phase2-trash-cancel.test/existing","title":"duplicate","type":"imgur"}]'::jsonb
	),
	'{"insertedCount": 0, "skippedCount": 1}'::jsonb,
	're-crawling an existing Trash thread does not treat it as newly collected'
);
select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url = 'https://phase2-trash-cancel.test/existing'
	),
	0::bigint,
	'existing Trash thread receives no metadata'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url = 'https://phase2-trash-cancel.test/existing'
	),
	0::bigint,
	'existing Trash thread receives no job'
);

create temporary table phase2_trash_guard_claim as
select *
from public.claim_media_enrichment_jobs('imgur', 100, 60);
select is(
	(
		select count(*)
		from phase2_trash_guard_claim
		where thread_id = (
			select id
			from public.threads
			where url = 'https://phase2-trash-cancel.test/claim-guard'
		)
	),
	0::bigint,
	'claim excludes an active job whose thread is already in Trash'
);
select ok(
	(
		select job.state = 'queued' and job.attempt_count = 0
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url = 'https://phase2-trash-cancel.test/claim-guard'
	),
	'claim leaves a Trash job untouched'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(
			select id
			from public.threads
			where url = 'https://phase2-trash-cancel.test/single'
		),
		'inbox',
		'trash'
	),
	'single transition to Trash succeeds while cancelling active media work'
);
select lives_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(
			select id
			from public.threads
			where url = 'https://phase2-trash-cancel.test/saved'
		),
		'saved',
		'trash'
	),
	'saved transition to Trash succeeds while cancelling active media work'
);
select ok(
	public.bulk_move_inbox_to_trash() >= 1,
	'bulk Trash transition succeeds while cancelling active media work'
);
reset role;

select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url in (
			'https://phase2-trash-cancel.test/single',
			'https://phase2-trash-cancel.test/saved',
			'https://phase2-trash-cancel.test/bulk'
		)
	),
	0::bigint,
	'entering Trash deletes pending metadata for single and bulk transitions'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url in (
			'https://phase2-trash-cancel.test/single',
			'https://phase2-trash-cancel.test/saved',
			'https://phase2-trash-cancel.test/bulk'
		)
	),
	0::bigint,
	'entering Trash cascades queued, retry, and processing job cancellation'
);
select is(
	public.complete_media_enrichment_job(
		(
			select id
			from public.threads
			where url = 'https://phase2-trash-cancel.test/bulk'
		),
		'00000000-0000-4000-8000-000000000901'::uuid,
		'{"status":"ready","media_kind":"video"}'::jsonb
	),
	false,
	'a worker cannot complete a processing lease after Trash cancellation'
);
select ok(
	(
		select metadata.status = 'ready' and job.state = 'succeeded'
		from public.thread_media_metadata as metadata
		inner join public.media_enrichment_jobs as job using (thread_id)
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url = 'https://phase2-trash-cancel.test/succeeded'
			and thread.state = 'trash'
	),
	'Trash preserves already completed metadata and its terminal job'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	format(
		'select public.transition_thread_state(%s, %L, %L)',
		(
			select id
			from public.threads
			where url = 'https://phase2-trash-cancel.test/bulk'
		),
		'trash',
		'inbox'
	),
	'restoring a cancelled Trash thread succeeds'
);
reset role;
select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url = 'https://phase2-trash-cancel.test/bulk'
	),
	0::bigint,
	'restoring a cancelled thread does not recreate metadata'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url = 'https://phase2-trash-cancel.test/bulk'
	),
	0::bigint,
	'restoring a cancelled thread does not enqueue a non-new job'
);

select * from finish();
rollback;
