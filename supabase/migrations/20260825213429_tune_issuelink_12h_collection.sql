do $$
begin
	update public.crawl_source_policies
	set
		cooldown_seconds = 10800,
		recommended_cooldown_seconds = 10800,
		updated_at = clock_timestamp()
	where source = 'issuelink';

	if not found then
		raise exception 'IssueLink crawl source policy does not exist.';
	end if;
end;
$$;
