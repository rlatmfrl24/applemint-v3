create index if not exists idx_new_threads_created_at_id
	on public."new-threads" (created_at desc, id desc);

create index if not exists idx_new_threads_type
	on public."new-threads" (type);

create index if not exists idx_new_threads_issuelink_category
	on public."new-threads" ((tag[2]))
	where type = 'issuelink';

delete from public."crawl-history" as ch
using (
	select ctid
	from (
		select
			ctid,
			row_number() over (
				partition by crawl_source, url
				order by created_at desc nulls last, ctid desc
			) as rn
		from public."crawl-history"
	) as ranked
	where ranked.rn > 1
) as duplicates
where ch.ctid = duplicates.ctid;

create unique index if not exists idx_crawl_history_source_url_unique
	on public."crawl-history" (crawl_source, url);

create or replace function public.get_new_threads_stats(
	in_scope text default 'normal',
	in_filter_type text default null,
	in_issuelink_category text default null
)
returns table (
	key text,
	label text,
	count bigint,
	total_count bigint
)
language sql
stable
as $$
	with filtered_rows as (
		select type, tag
		from public."new-threads"
		where
			(
				in_scope <> 'normal'
				or (type <> 'media' and type <> 'youtube')
			)
			and (
				in_filter_type is null
				or (
					in_filter_type = 'issuelink'
					and type = 'issuelink'
					and (
						in_issuelink_category is null
						or tag[2] = in_issuelink_category
					)
				)
				or (
					in_filter_type <> 'issuelink'
					and type = in_filter_type
				)
			)
	),
	grouped_rows as (
		select
			case
				when type = 'issuelink' then 'issuelink::' || coalesce(tag[2], 'unknown')
				else type
			end as key,
			case
				when type = 'issuelink' then coalesce(tag[2], 'unknown')
				else type
			end as label,
			count(*)::bigint as count
		from filtered_rows
		group by 1, 2
	),
	total_rows as (
		select count(*)::bigint as total_count
		from filtered_rows
	)
	select grouped_rows.key, grouped_rows.label, grouped_rows.count, total_rows.total_count
	from grouped_rows
	cross join total_rows
	order by grouped_rows.count desc;
$$;
