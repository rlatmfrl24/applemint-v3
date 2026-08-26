begin;

create or replace function public.update_crawl_source_policy(
	p_source text,
	p_schedule_enabled boolean,
	p_cooldown_seconds integer,
	p_expected_updated_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_updated boolean;
	v_settings jsonb;
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can update crawl source policies.';
	end if;

	-- Serialize the activity check and policy mutation with source retirement.
	-- Every source lifecycle path takes this lock before touching source-owned rows.
	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended(
			'applemint:crawl-source-lifecycle:' || p_source,
			0
		)
	);

	if not exists (
		select 1
		from public.crawl_source_registry as registry
		where registry.source = p_source and registry.active
	) then
		raise exception using errcode = '22023', message = 'Unsupported crawl source.';
	end if;
	if p_schedule_enabled is null or p_expected_updated_at is null then
		raise exception using errcode = '22023', message = 'Crawl source policy fields are required.';
	end if;
	if p_cooldown_seconds < 1800
		or p_cooldown_seconds > 604800
		or p_cooldown_seconds % 60 <> 0
	then
		raise exception using
			errcode = '22023',
			message = 'Crawl cooldown must be a whole minute between 30 minutes and 7 days.';
	end if;

	update public.crawl_source_policies
	set
		schedule_enabled = p_schedule_enabled,
		cooldown_seconds = p_cooldown_seconds,
		updated_at = clock_timestamp()
	where source = p_source and updated_at = p_expected_updated_at
	returning true into v_updated;

	v_settings := public.get_crawl_source_policy_settings();
	return jsonb_build_object(
		'updated', coalesce(v_updated, false),
		'reason', case when coalesce(v_updated, false) then null else 'conflict' end,
		'settings', v_settings
	);
end;
$$;

alter function public.update_crawl_source_policy(
	text,
	boolean,
	integer,
	timestamp with time zone
) owner to postgres;
revoke all on function public.update_crawl_source_policy(
	text,
	boolean,
	integer,
	timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.update_crawl_source_policy(
	text,
	boolean,
	integer,
	timestamp with time zone
) to authenticated;

commit;
