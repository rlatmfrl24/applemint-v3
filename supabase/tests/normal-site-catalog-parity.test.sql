-- Keep SQL normal-site classification aligned with the TypeScript display catalog.
begin;

select plan(2);

create temporary table normal_site_catalog_fixture (
	site_key text primary key,
	label text not null,
	sample_host text not null
);

\ir fixtures/normal-site-catalog-values.inc

select is(
	(select count(*) from normal_site_catalog_fixture),
	18::bigint,
	'shared normal-site catalog contains every supported representative label'
);

select is(
	(
		select count(*)
		from normal_site_catalog_fixture
		where public.normalize_normal_site_key(sample_host) is distinct from site_key
	),
	0::bigint,
	'SQL normalization matches every site key in the shared TypeScript catalog fixture'
);

select * from finish();
rollback;
