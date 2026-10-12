begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.ingest_crawl_items(
	p_crawl_source text,
	p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_result jsonb;
begin
	if not exists (
		select 1 from public.crawl_source_registry as registry
		where registry.source = p_crawl_source and registry.active
	) then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;
	if p_items is null or jsonb_typeof(p_items) <> 'array' then
		raise exception using errcode = '22023', message = 'Crawl items must be a JSON array.';
	end if;
	if jsonb_array_length(p_items) > 1000 then
		raise exception using errcode = '22023', message = 'A crawl batch cannot exceed 1000 items.';
	end if;
	if exists (
		select 1 from jsonb_array_elements(p_items) as payload(item)
		where item ? 'historyUrl' and jsonb_typeof(item -> 'historyUrl') not in ('string', 'null')
	) then
		raise exception using errcode = '22023', message = 'History URL must be a string.';
	end if;
	if exists (
		select 1 from jsonb_array_elements(p_items) as payload(item)
		where coalesce(nullif(btrim(item ->> 'type'), ''), 'normal') in ('media', 'issuelink')
	) then
		raise exception using errcode = '23514', message = 'Retired thread types cannot be ingested.';
	end if;

	with normalized_payload as materialized (
		select distinct on (btrim(item ->> 'url'), coalesce(nullif(btrim(item ->> 'historyUrl'), ''), btrim(item ->> 'url')))
			btrim(item ->> 'url') as url,
			coalesce(nullif(btrim(item ->> 'historyUrl'), ''), btrim(item ->> 'url')) as history_url,
			nullif(item ->> 'title', '') as title,
			nullif(item ->> 'description', '') as description,
			nullif(item ->> 'host', '') as host,
			coalesce(nullif(btrim(item ->> 'type'), ''), 'normal') as type,
			case when jsonb_typeof(item -> 'tag') = 'array'
				then array(select jsonb_array_elements_text(item -> 'tag'))
				else null
			end as tag
		from jsonb_array_elements(p_items) as payload(item)
		where nullif(btrim(item ->> 'url'), '') is not null
		order by btrim(item ->> 'url'), coalesce(nullif(btrim(item ->> 'historyUrl'), ''), btrim(item ->> 'url'))
	),
	history_payload as materialized (
		select distinct on (history_url) *
		from normalized_payload
		order by history_url, url
	),
	claimed as (
		insert into public."crawl-history" (url, crawl_source, host)
		select payload.history_url, p_crawl_source, payload.host
		from history_payload as payload
		on conflict (crawl_source, url) do nothing
		returning url as history_url
	),
	claimed_originals as (
		-- Claim the original too: old callers and distinct aliases share this uniqueness boundary.
		insert into public."crawl-history" (url, crawl_source, host)
		select payload.url, p_crawl_source, payload.host
		from history_payload as payload
		inner join claimed using (history_url)
		where payload.url <> payload.history_url
		order by payload.url
		on conflict (crawl_source, url) do nothing
		returning url
	),
	inserted as (
		insert into public.threads (url, title, description, host, type, tag, state)
		select distinct on (payload.url) payload.url, payload.title, payload.description, payload.host,
			payload.type, payload.tag, 'inbox'
		from history_payload as payload
		inner join claimed using (history_url)
		where payload.url = payload.history_url
			or exists (select 1 from claimed_originals where claimed_originals.url = payload.url)
		order by payload.url, payload.history_url
		returning id, url, type
	),
	inserted_metadata as (
		insert into public.thread_media_metadata (thread_id, provider, status)
		select inserted.id, 'youtube', 'pending' from inserted
		where inserted.type = 'youtube'
		returning thread_id, provider
	),
	inserted_jobs as (
		insert into public.media_enrichment_jobs (thread_id, provider, state)
		select thread_id, provider, 'queued' from inserted_metadata
		returning thread_id
	),
	counts as (
		select (select count(*) from normalized_payload) as input_count,
			(select count(*) from inserted) as inserted_count
	)
	select jsonb_build_object('insertedCount', inserted_count, 'skippedCount', input_count - inserted_count)
	into v_result from counts;

	return coalesce(v_result, jsonb_build_object('insertedCount', 0, 'skippedCount', 0));
end;
$$;

alter function public.ingest_crawl_items(text, jsonb) owner to postgres;
revoke all on function public.ingest_crawl_items(text, jsonb)
	from public, anon, authenticated, service_role;
grant execute on function public.ingest_crawl_items(text, jsonb) to service_role;
commit;
