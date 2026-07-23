begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
	if exists (
		select 1
		from public."crawl-history"
		where url is null
			or btrim(url) = ''
			or crawl_source is null
			or btrim(crawl_source) = ''
			or crawl_source not in ('arcalive', 'battlepage', 'insagirl', 'issuelink')
	) then
		raise exception using
			errcode = '23514',
			message = 'crawl-history contains rows that violate the canonical dedupe contract.';
	end if;

	if exists (
		select 1
		from public."filter-keyword"
		where value is null
			or btrim(value) = ''
			or method is null
			or btrim(method) = ''
	) then
		raise exception using
			errcode = '23514',
			message = 'filter-keyword contains incomplete classifier rows.';
	end if;

	if exists (
		select 1
		from public."filter-keyword"
		group by value
		having count(*) > 1
	) then
		raise exception using
			errcode = '23505',
			message = 'filter-keyword contains duplicate classifier values.';
	end if;

	if exists (
		select 1
		from public.threads
		where url is null
			or btrim(url) = ''
			or type is null
			or btrim(type) = ''
			or type in ('media', 'youtube', 'issuelink')
	) then
		raise exception using
			errcode = '23514',
			message = 'threads contains rows that violate the canonical content contract.';
	end if;
end;
$$;

-- IssueLink 수집기는 제거됐으므로 활성 분류 설정만 삭제한다.
-- 영구 중복 방지 집합인 crawl-history의 과거 IssueLink 행은 보존한다.
delete from public."filter-keyword"
where method = 'issuelink';

alter table public."crawl-history"
	alter column url set not null,
	alter column crawl_source set not null,
	add constraint crawl_history_url_nonempty_check
		check (btrim(url) <> ''),
	add constraint crawl_history_source_check
		check (crawl_source in ('arcalive', 'battlepage', 'insagirl', 'issuelink'));

alter table public."filter-keyword"
	alter column value set not null,
	alter column method set not null,
	drop constraint filter_keyword_no_removed_media_types,
	add constraint filter_keyword_value_nonempty_check
		check (btrim(value) <> ''),
	add constraint filter_keyword_method_nonempty_check
		check (btrim(method) <> ''),
	add constraint filter_keyword_no_removed_types
		check (method not in ('media', 'youtube', 'issuelink')),
	add constraint filter_keyword_value_key
		unique (value);

alter table public.threads
	alter column url set not null,
	alter column type set default 'normal',
	alter column type set not null,
	drop constraint threads_no_removed_media_types,
	add constraint threads_url_nonempty_check
		check (btrim(url) <> ''),
	add constraint threads_type_nonempty_check
		check (btrim(type) <> ''),
	add constraint threads_no_removed_types
		check (type not in ('media', 'youtube', 'issuelink'));

create index crawl_schedule_dispatches_run_id_idx
	on public.crawl_schedule_dispatches (run_id);

comment on table public."crawl-history" is
	'Permanent dedupe set keyed by crawl_source and url. Retired-source history is retained.';
comment on column public."crawl-history".url is
	'Canonical non-empty URL used by the permanent dedupe key.';
comment on column public."crawl-history".crawl_source is
	'Crawler source. IssueLink is accepted only to retain historical dedupe rows.';
comment on table public."filter-keyword" is
	'Active crawler URL classifiers. Each non-empty value maps to one method.';
comment on column public.threads.url is
	'Canonical non-empty URL for the logical thread.';
comment on column public.threads.type is
	'Active thread classifier. Defaults to normal and excludes retired classifiers.';
comment on column public.crawl_schedule_dispatches.run_id is
	'Resolved crawl run. Indexed to support the foreign-key relationship and reconciliation.';

commit;
