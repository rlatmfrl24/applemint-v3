begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 공급자 타입은 정확한 URL parser가 소유하며 부분 문자열 설정으로 만들지 않는다.
delete from public."filter-keyword"
where method in ('youtube', 'imgur');

alter table public."filter-keyword"
	drop constraint filter_keyword_no_removed_types,
	add constraint filter_keyword_no_provider_or_retired_types
		check (method not in ('media', 'youtube', 'imgur', 'issuelink'));

alter table public.threads
	drop constraint threads_no_removed_types,
	add constraint threads_no_retired_types
		check (type not in ('media', 'issuelink'));

comment on table public."filter-keyword" is
	'Non-provider crawler URL classifiers. YouTube and Imgur are assigned by exact URL parsing.';
comment on constraint filter_keyword_no_provider_or_retired_types on public."filter-keyword" is
	'Retired types and exact-URL provider types cannot be assigned by substring classifiers.';
comment on constraint threads_no_retired_types on public.threads is
	'Retired media and IssueLink types remain unavailable; youtube and imgur are active.';

create or replace function public.ingest_crawl_items(
	p_crawl_source text,
	p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_result jsonb;
begin
	if p_crawl_source not in ('arcalive', 'battlepage', 'insagirl') then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;
	if p_items is null or jsonb_typeof(p_items) <> 'array' then
		raise exception using errcode = '22023', message = 'Crawl items must be a JSON array.';
	end if;
	if jsonb_array_length(p_items) > 1000 then
		raise exception using errcode = '22023', message = 'A crawl batch cannot exceed 1000 items.';
	end if;
	if exists (
		select 1
		from jsonb_array_elements(p_items) as payload(item)
		where coalesce(nullif(btrim(item ->> 'type'), ''), 'normal') in ('media', 'issuelink')
	) then
		raise exception using
			errcode = '23514',
			message = 'Retired thread types cannot be ingested.';
	end if;

	with normalized_payload as materialized (
		select distinct on (btrim(item ->> 'url'))
			btrim(item ->> 'url') as url,
			nullif(item ->> 'title', '') as title,
			nullif(item ->> 'description', '') as description,
			nullif(item ->> 'host', '') as host,
			coalesce(nullif(btrim(item ->> 'type'), ''), 'normal') as type,
			case
				when jsonb_typeof(item -> 'tag') = 'array' then
					array(select jsonb_array_elements_text(item -> 'tag'))
				else null
			end as tag
		from jsonb_array_elements(p_items) as payload(item)
		where nullif(btrim(item ->> 'url'), '') is not null
		order by btrim(item ->> 'url')
	),
	claimed as (
		insert into public."crawl-history" (url, crawl_source, host)
		select url, p_crawl_source, host
		from normalized_payload
		on conflict (crawl_source, url) do nothing
		returning url
	),
	inserted as (
		insert into public.threads (url, title, description, host, type, tag, state)
		select payload.url, payload.title, payload.description, payload.host,
			payload.type, payload.tag, 'inbox'
		from normalized_payload as payload
		inner join claimed using (url)
		returning url
	),
	counts as (
		select
			(select count(*) from normalized_payload) as input_count,
			(select count(*) from inserted) as inserted_count
	)
	select jsonb_build_object(
		'insertedCount', inserted_count,
		'skippedCount', input_count - inserted_count
	)
	into v_result
	from counts;

	return coalesce(v_result, jsonb_build_object('insertedCount', 0, 'skippedCount', 0));
end;
$$;

revoke all on function public.ingest_crawl_items(text, jsonb)
	from public, anon, authenticated;
grant execute on function public.ingest_crawl_items(text, jsonb) to service_role;

with classified as materialized (
	select
		id,
		case
			when btrim(url) ~* '^https?://(youtube\.com|www\.youtube\.com|m\.youtube\.com|music\.youtube\.com|youtu\.be)(:[0-9]+)?/[^?#]+([?#].*)?$'
				then 'youtube'
			when btrim(url) ~* '^https?://(imgur\.com|www\.imgur\.com|i\.imgur\.com)(:[0-9]+)?/[^?#]+([?#].*)?$'
				then 'imgur'
			else null
		end as desired_type
	from public.threads
),
updated as (
	update public.threads as thread
	set type = classified.desired_type
	from classified
	where thread.id = classified.id
		and classified.desired_type is not null
		and thread.type is distinct from classified.desired_type
	returning thread.id
)
select count(*) from updated;

commit;
