begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function private.cancel_active_media_enrichment_on_trash()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	delete from public.thread_media_metadata as metadata
	where metadata.thread_id = new.id
		and exists (
			select 1
			from public.media_enrichment_jobs as job
			where job.thread_id = metadata.thread_id
				and job.state in ('queued', 'retry', 'processing')
		);

	return new;
end;
$$;

comment on function private.cancel_active_media_enrichment_on_trash() is
	'Deletes pending media metadata and its cascading active job when a thread enters Trash.';

revoke all on function private.cancel_active_media_enrichment_on_trash()
	from public, anon, authenticated, service_role;

create trigger cancel_active_media_enrichment_on_trash
after update of state on public.threads
for each row
when (new.state = 'trash' and old.state is distinct from new.state)
execute function private.cancel_active_media_enrichment_on_trash();

comment on trigger cancel_active_media_enrichment_on_trash on public.threads is
	'Cancels queued, retry, or processing media enrichment when a thread enters Trash.';

create or replace function public.claim_media_enrichment_jobs(
	p_provider text,
	p_limit integer,
	p_lease_seconds integer
)
returns table (
	thread_id bigint,
	provider text,
	url text,
	attempt_count integer,
	lease_token uuid,
	lease_expires_at timestamp with time zone
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := clock_timestamp();
begin
	if p_provider is null or p_provider not in ('youtube', 'imgur') then
		raise exception using errcode = '22023', message = 'Unsupported media provider.';
	end if;
	if p_limit is null or p_limit < 1 or p_limit > 100 then
		raise exception using errcode = '22023', message = 'Claim limit must be between 1 and 100.';
	end if;
	if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
		raise exception using errcode = '22023', message = 'Lease duration must be between 1 and 3600 seconds.';
	end if;

	return query
	with candidates as materialized (
		select job.thread_id
		from public.media_enrichment_jobs as job
		inner join public.threads as thread on thread.id = job.thread_id
		where job.provider = p_provider
			and thread.state in ('inbox', 'saved')
			and (
				(
					job.state in ('queued', 'retry')
					and job.available_at <= v_now
				)
				or (
					job.state = 'processing'
					and job.lease_expires_at <= v_now
				)
			)
		order by
			case
				when job.state = 'processing' then job.lease_expires_at
				else job.available_at
			end,
			job.created_at,
			job.thread_id
		for update of job skip locked
		limit p_limit
	),
	claimed as (
		update public.media_enrichment_jobs as job
		set
			state = 'processing',
			attempt_count = job.attempt_count + 1,
			lease_token = gen_random_uuid(),
			lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
			last_error_code = null,
			updated_at = v_now
		from candidates
		where job.thread_id = candidates.thread_id
		returning
			job.thread_id,
			job.provider,
			job.attempt_count,
			job.lease_token,
			job.lease_expires_at
	)
	select
		claimed.thread_id,
		claimed.provider,
		thread.url,
		claimed.attempt_count,
		claimed.lease_token,
		claimed.lease_expires_at
	from claimed
	inner join public.threads as thread on thread.id = claimed.thread_id
	order by claimed.thread_id;
end;
$$;

revoke all on function public.claim_media_enrichment_jobs(text, integer, integer)
	from public, anon, authenticated, service_role;
grant execute on function public.claim_media_enrichment_jobs(text, integer, integer)
	to service_role;

delete from public.thread_media_metadata as metadata
using public.media_enrichment_jobs as job, public.threads as thread
where job.thread_id = metadata.thread_id
	and thread.id = metadata.thread_id
	and thread.state = 'trash'
	and job.state in ('queued', 'retry', 'processing');

commit;
