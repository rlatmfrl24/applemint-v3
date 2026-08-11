-- YouTube-only metadata queue contract.
begin;

select no_plan();

select has_table(
	'public',
	'thread_media_metadata',
	'YouTube metadata summary table exists'
);
select has_table(
	'public',
	'media_enrichment_jobs',
	'YouTube enrichment durable queue exists'
);
select ok(
	(
		select pg_get_constraintdef(oid)
		from pg_constraint
		where conrelid = 'public.thread_media_metadata'::regclass
			and conname = 'thread_media_metadata_provider_check'
	) like '%youtube%',
	'metadata provider constraint is YouTube-only'
);
select ok(
	(
		select pg_get_constraintdef(oid)
		from pg_constraint
		where conrelid = 'public.media_enrichment_jobs'::regclass
			and conname = 'media_enrichment_jobs_provider_check'
	) like '%youtube%',
	'job provider constraint is YouTube-only'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.thread_media_metadata'::regclass
			and contype = 'p'
	)
		and exists (
			select 1
			from pg_constraint
			where conrelid = 'public.thread_media_metadata'::regclass
				and contype = 'f'
				and confrelid = 'public.threads'::regclass
				and confdeltype = 'c'
		),
	'metadata keeps its primary key and cascading thread FK'
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
	'jobs keep cascading metadata FK'
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
	'media tables keep RLS enabled'
);
select ok(
	has_table_privilege('authenticated', 'public.thread_media_metadata', 'SELECT')
		and not has_table_privilege(
			'authenticated',
			'public.thread_media_metadata',
			'INSERT,UPDATE,DELETE'
		)
		and not has_table_privilege(
			'authenticated',
			'public.media_enrichment_jobs',
			'SELECT,INSERT,UPDATE,DELETE'
		),
	'authenticated can only read owner-visible metadata and cannot access jobs'
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
	'service role keeps metadata and job privileges'
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
		and not has_function_privilege(
			'authenticated',
			'public.claim_media_enrichment_jobs(text,integer,integer)',
			'EXECUTE'
		),
	'queue lifecycle RPCs remain service-role-only'
);

set local role service_role;

select is(
	public.ingest_crawl_items(
		'arcalive',
		'[
			{"url":"https://www.youtube.com/watch?v=phase2video","title":"youtube","type":"youtube"},
			{"url":"https://example.com/normal","title":"normal","type":"normal"}
		]'::jsonb
	),
	jsonb_build_object('insertedCount', 2, 'skippedCount', 0),
	'ingest accepts YouTube and normal thread types'
);
select is(
	(
		select count(*)
		from public.thread_media_metadata as metadata
		inner join public.threads as thread on thread.id = metadata.thread_id
		where thread.url in ('https://www.youtube.com/watch?v=phase2video', 'https://example.com/normal')
			and metadata.provider = 'youtube'
	),
	1::bigint,
	'only the YouTube thread receives metadata'
);
select is(
	(
		select count(*)
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where thread.url in ('https://www.youtube.com/watch?v=phase2video', 'https://example.com/normal')
			and job.provider = 'youtube'
	),
	1::bigint,
	'only the YouTube thread receives a queue job'
);
select throws_ok(
	$$select * from public.claim_media_enrichment_jobs('unsupported', 1, 60)$$,
	'22023',
	'Unsupported media provider.',
	'unsupported providers cannot be claimed'
);
select throws_ok(
	$$
		insert into public.thread_media_metadata (thread_id, provider)
		select id, 'unsupported'
		from public.threads
		where url = 'https://example.com/normal'
	$$,
	'23514',
	null,
	'unsupported metadata providers cannot be inserted directly'
);
select is(
	public.ingest_crawl_items(
		'arcalive',
		'[{"url":"https://example.com/normal","title":"duplicate","type":"normal"}]'::jsonb
	),
	jsonb_build_object('insertedCount', 0, 'skippedCount', 1),
	'duplicate crawl remains idempotent through crawl-history'
);

create temporary table claimed_youtube_job as
select *
from public.claim_media_enrichment_jobs('youtube', 1, 60);

select is(
	(select count(*) from claimed_youtube_job),
	1::bigint,
	'YouTube worker claims the queued job'
);
select is(
	public.complete_media_enrichment_job(
		(select thread_id from claimed_youtube_job),
		'00000000-0000-4000-8000-000000000099'::uuid,
		'{"status":"ready","external_id":"phase2video","media_kind":"video"}'::jsonb
	),
	false,
	'wrong lease token cannot complete a job'
);
select is(
	public.complete_media_enrichment_job(
		(select thread_id from claimed_youtube_job),
		(select lease_token from claimed_youtube_job),
		'{
			"status":"ready",
			"external_id":"phase2video",
			"media_kind":"video",
			"title":"공식 제목",
			"channel_title":"공식 채널",
			"thumbnail_url":"https://i.ytimg.com/vi/phase2video/hqdefault.jpg",
			"duration_seconds":125,
			"live_status":"none"
		}'::jsonb
	),
	true,
	'matching lease token completes YouTube metadata'
);
select is(
	(
		select row(metadata.provider, metadata.status, metadata.duration_seconds)
		from public.thread_media_metadata as metadata
		where metadata.thread_id = (select thread_id from claimed_youtube_job)
	),
	row('youtube'::text, 'ready'::text, 125),
	'completed metadata stores the normalized YouTube summary'
);
select is(
	(
		select state
		from public.media_enrichment_jobs
		where thread_id = (select thread_id from claimed_youtube_job)
	),
	'succeeded',
	'completed YouTube job becomes succeeded'
);

select throws_ok(
	$$
		select public.ingest_crawl_items(
			'arcalive',
			'[{"url":"https://phase2-retired.test/media","type":"media"}]'::jsonb
		)
	$$,
	'23514',
	'Retired thread types cannot be ingested.',
	'retired media type remains rejected'
);
select throws_ok(
	$$
		select public.ingest_crawl_items(
			'arcalive',
			'[{"url":"https://phase2-retired.test/issuelink","type":"issuelink"}]'::jsonb
		)
	$$,
	'23514',
	'Retired thread types cannot be ingested.',
	'retired issuelink type remains rejected'
);

reset role;

create function pg_temp.reject_youtube_queue_insert()
returns trigger
language plpgsql
as $$
begin
	raise exception 'fixture queue failure';
end;
$$;
create trigger reject_youtube_queue_insert
before insert on public.media_enrichment_jobs
for each row execute function pg_temp.reject_youtube_queue_insert();

set local role service_role;
select throws_ok(
	$$
		select public.ingest_crawl_items(
			'battlepage',
			'[{"url":"https://www.youtube.com/watch?v=rollbackvid","type":"youtube"}]'::jsonb
		)
	$$,
	'P0001',
	'fixture queue failure',
	'queue failure rolls back the whole ingest transaction'
);
reset role;
drop trigger reject_youtube_queue_insert on public.media_enrichment_jobs;
select is(
	(
		select count(*)
		from public.threads
		where url = 'https://www.youtube.com/watch?v=rollbackvid'
	),
	0::bigint,
	'failed queue insert leaves no partial thread'
);
select is(
	(
		select count(*)
		from public."crawl-history"
		where url = 'https://www.youtube.com/watch?v=rollbackvid'
	),
	0::bigint,
	'failed queue insert leaves no partial crawl-history'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select is(
	(
		select media_metadata ->> 'provider'
		from public.list_threads_page('inbox', 100, null, null, 'youtube')
		where url = 'https://www.youtube.com/watch?v=phase2video'
	),
	'youtube',
	'YouTube list response keeps nullable metadata summary'
);
reset role;

select * from finish();

rollback;
