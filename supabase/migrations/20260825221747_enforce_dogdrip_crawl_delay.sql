-- Manual runs normally bypass source cooldowns, but DogDrip must retain the
-- robots.txt Crawl-delay boundary across serverless instances. Scheduled runs
-- keep the configured three-hour cooldown; manual runs retain a hard 10-second
-- floor measured from the prior completed attempt.
do $migration$
declare
	v_definition text;
	v_updated text;
begin
	v_definition := pg_get_functiondef(
		'public._begin_crawl_run(text,uuid,integer,text)'::regprocedure
	);
	v_updated := replace(
		v_definition,
		'if p_trigger = ''scheduled'' then
		select max(finished_at) into v_last_finished_at',
		'if p_trigger = ''scheduled'' or p_source = ''dogdrip'' then
		select max(finished_at) into v_last_finished_at'
	);
	if v_updated = v_definition then
		raise exception 'Expected _begin_crawl_run cooldown trigger was not found.';
	end if;

	v_definition := v_updated;
	v_updated := replace(
		v_definition,
		'v_next_eligible_at := v_last_finished_at + make_interval(secs => v_policy.cooldown_seconds);',
		'v_next_eligible_at := v_last_finished_at + make_interval(
				secs => case
					when p_trigger = ''scheduled'' then v_policy.cooldown_seconds
					else 10
				end
			);'
	);
	if v_updated = v_definition then
		raise exception 'Expected _begin_crawl_run cooldown interval was not found.';
	end if;
	execute v_updated;
end;
$migration$;

revoke all on function public._begin_crawl_run(text, uuid, integer, text)
	from public, anon, authenticated, service_role;
grant execute on function public._begin_crawl_run(text, uuid, integer, text)
	to service_role;
