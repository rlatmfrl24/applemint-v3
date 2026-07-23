begin;

select plan(18);

select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."crawl-history"'::regclass and attname = 'url'
	),
	'crawl-history url is required'
);
select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."crawl-history"'::regclass and attname = 'crawl_source'
	),
	'crawl-history source is required'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."crawl-history"'::regclass
			and conname = 'crawl_history_url_nonempty_check'
			and contype = 'c'
	),
	'crawl-history rejects empty URLs'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."crawl-history"'::regclass
			and conname = 'crawl_history_source_check'
			and contype = 'c'
	),
	'crawl-history accepts only active sources and retained IssueLink history'
);

select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."filter-keyword"'::regclass and attname = 'value'
	),
	'filter keyword value is required'
);
select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public."filter-keyword"'::regclass and attname = 'method'
	),
	'filter keyword method is required'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_value_nonempty_check'
			and contype = 'c'
	),
	'filter keywords reject empty values'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_method_nonempty_check'
			and contype = 'c'
	),
	'filter keywords reject empty methods'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_no_removed_types'
			and contype = 'c'
	),
	'filter keywords reject retired classifiers'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public."filter-keyword"'::regclass
			and conname = 'filter_keyword_value_key'
			and contype = 'u'
	),
	'each filter keyword maps to one classifier'
);
select is(
	(select count(*) from public."filter-keyword" where method = 'issuelink'),
	0::bigint,
	'retired IssueLink classifier configuration is removed'
);

select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public.threads'::regclass and attname = 'url'
	),
	'thread URL is required'
);
select ok(
	(
		select attnotnull
		from pg_attribute
		where attrelid = 'public.threads'::regclass and attname = 'type'
	),
	'thread type is required'
);
select col_default_is(
	'public',
	'threads',
	'type',
	'normal',
	'thread type defaults to normal'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.threads'::regclass
			and conname = 'threads_url_nonempty_check'
			and contype = 'c'
	),
	'threads reject empty URLs'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.threads'::regclass
			and conname = 'threads_type_nonempty_check'
			and contype = 'c'
	),
	'threads reject empty types'
);
select ok(
	exists (
		select 1
		from pg_constraint
		where conrelid = 'public.threads'::regclass
			and conname = 'threads_no_removed_types'
			and contype = 'c'
	),
	'threads reject retired classifiers'
);

select has_index(
	'public',
	'crawl_schedule_dispatches',
	'crawl_schedule_dispatches_run_id_idx',
	'dispatch run foreign key has a covering index'
);

select * from finish();
rollback;
