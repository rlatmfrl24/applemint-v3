begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.media_worker_runtime_settings
	add column imgur_enrichment_cutoff_at timestamp with time zone;

update public.media_worker_runtime_settings
set
	imgur_enrichment_cutoff_at = clock_timestamp(),
	updated_at = clock_timestamp()
where id = true;

alter table public.media_worker_runtime_settings
	alter column imgur_enrichment_cutoff_at set not null,
	alter column imgur_enrichment_cutoff_at set default clock_timestamp();

comment on column public.media_worker_runtime_settings.imgur_enrichment_cutoff_at is
	'Only Imgur threads inserted on or after this cutover are eligible for metadata enrichment.';

delete from public.thread_media_metadata as metadata
using public.media_worker_runtime_settings as settings
where settings.id = true
	and metadata.provider = 'imgur'
	and metadata.created_at < settings.imgur_enrichment_cutoff_at;

commit;
