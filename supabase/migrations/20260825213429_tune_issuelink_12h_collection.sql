do $$
begin
	update public.crawl_source_policies
	set
		cooldown_seconds = 43200,
		recommended_cooldown_seconds = 43200,
		updated_at = clock_timestamp()
	where source = 'issuelink';

	if not found then
		raise exception 'IssueLink crawl source policy does not exist.';
	end if;
end;
$$;
