begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.cancel_active_media_enrichment_on_trash()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	perform 1
	from public.media_enrichment_jobs as job
	where job.thread_id = new.id
		and job.state in ('queued', 'retry', 'processing')
	for update;

	if not found then
		return new;
	end if;

	delete from public.thread_media_metadata as metadata
	where metadata.thread_id = new.id;

	return new;
end;
$$;

comment on function private.cancel_active_media_enrichment_on_trash() is
	'Locks active media work before deleting pending metadata and its cascading job when a thread enters Trash.';

revoke all on function private.cancel_active_media_enrichment_on_trash()
	from public, anon, authenticated, service_role;

commit;
