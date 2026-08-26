-- Crawl response contract failures are durably recorded through a service-only recovery RPC.
begin;

select plan(14);

select has_function(
	'public',
	'record_crawl_run_contract_failure',
	array['bigint', 'uuid', 'text', 'text'],
	'crawl contract failure recovery function exists'
);
select function_returns(
	'public',
	'record_crawl_run_contract_failure',
	array['bigint', 'uuid', 'text', 'text'],
	'boolean',
	'crawl contract failure recovery reports whether a run was updated'
);
select is(
	(
		select prosecdef
		from pg_proc
		where oid = 'public.record_crawl_run_contract_failure(bigint, uuid, text, text)'::regprocedure
	),
	true,
	'crawl contract failure recovery is SECURITY DEFINER'
);
select is(
	(
		select proconfig
		from pg_proc
		where oid = 'public.record_crawl_run_contract_failure(bigint, uuid, text, text)'::regprocedure
	),
	array['search_path=""']::text[],
	'crawl contract failure recovery has an empty search_path'
);
select is(
	(
		select pg_get_userbyid(proowner)
		from pg_proc
		where oid = 'public.record_crawl_run_contract_failure(bigint, uuid, text, text)'::regprocedure
	),
	'postgres',
	'crawl contract failure recovery is owned by postgres'
);
select ok(
	not has_function_privilege('public', 'public.record_crawl_run_contract_failure(bigint, uuid, text, text)', 'EXECUTE')
		and not has_function_privilege('anon', 'public.record_crawl_run_contract_failure(bigint, uuid, text, text)', 'EXECUTE')
		and not has_function_privilege('authenticated', 'public.record_crawl_run_contract_failure(bigint, uuid, text, text)', 'EXECUTE')
		and has_function_privilege('service_role', 'public.record_crawl_run_contract_failure(bigint, uuid, text, text)', 'EXECUTE'),
	'only service_role and the function owner can execute recovery'
);

insert into public.crawl_runs (
	id,
	source,
	lock_token,
	status,
	run_trigger,
	stale_after,
	finished_at,
	duration_ms
)
values (
	9000000000000901,
	'battlepage',
	'00000000-0000-4000-8000-000000000901',
	'succeeded',
	'manual',
	now() + interval '60 seconds',
	now(),
	0
);

insert into auth.users (id)
values ('480f5282-7933-4800-a970-d6bc8f05e8cf'::uuid);

insert into public.web_push_subscriptions (
	id,
	user_id,
	endpoint,
	p256dh,
	auth
)
values (
	9000000000000901,
	'480f5282-7933-4800-a970-d6bc8f05e8cf',
	'https://push.test/contract-failure',
	repeat('a', 32),
	'authkey1'
);

insert into public.web_push_deliveries (
	id,
	run_id,
	subscription_id,
	source,
	inserted_count
)
values (
	9000000000000901,
	9000000000000901,
	9000000000000901,
	'battlepage',
	1
);

set local role service_role;

select is(
	public.record_crawl_run_contract_failure(
		9000000000000901,
		'00000000-0000-4000-8000-000000000902',
		'unknown',
		'finish_crawl_run response contract is invalid.'
	),
	false,
	'a mismatched lock token cannot mutate the run'
);
select is(
	public.record_crawl_run_contract_failure(
		9000000000000901,
		'00000000-0000-4000-8000-000000000901',
		'unknown',
		'finish_crawl_run response contract is invalid.'
	),
	true,
	'the matching run and lock token record a contract failure'
);

reset role;

select is(
	(select status from public.crawl_runs where id = 9000000000000901),
	'failed',
	'recovery marks the crawl run failed'
);
select is(
	(select error_stage from public.crawl_runs where id = 9000000000000901),
	'unknown',
	'recovery stores the safe error stage'
);
select is(
	(select error_message from public.crawl_runs where id = 9000000000000901),
	'finish_crawl_run response contract is invalid.',
	'recovery stores the safe error message'
);
select isnt(
	(select finished_at from public.crawl_runs where id = 9000000000000901),
	null::timestamp with time zone,
	'recovery ensures the failed run is terminal'
);
select is(
	(
		select jsonb_build_object('state', state, 'error', last_error_code)
		from public.web_push_deliveries
		where run_id = 9000000000000901
	),
	'{"state":"skipped","error":"crawl-contract-failure"}'::jsonb,
	'recovery skips every unsent push delivery for the failed run'
);

set local role service_role;
select is(
	(
		select count(*)
		from public.claim_web_push_deliveries(20, 120)
		where run_id = '9000000000000901'
	),
	0::bigint,
	'a recovered contract failure cannot be claimed for delivery'
);
reset role;

select * from finish();
rollback;
