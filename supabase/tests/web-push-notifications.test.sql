-- Per-device Web Push outbox, badge, retry, and security contract.
begin;

select plan(47);

select has_table(
	'public',
	'web_push_subscriptions',
	'web push subscription table exists'
);
select has_table(
	'public',
	'web_push_deliveries',
	'web push delivery outbox exists'
);
select ok(
	(select relrowsecurity from pg_class where oid = 'public.web_push_subscriptions'::regclass)
		and (select relrowsecurity from pg_class where oid = 'public.web_push_deliveries'::regclass),
	'RLS is enabled on both web push tables'
);
select ok(
	not has_table_privilege('anon', 'public.web_push_subscriptions', 'SELECT')
		and not has_table_privilege('authenticated', 'public.web_push_subscriptions', 'SELECT')
		and not has_table_privilege('anon', 'public.web_push_deliveries', 'SELECT')
		and not has_table_privilege('authenticated', 'public.web_push_deliveries', 'SELECT'),
	'application roles cannot read push secrets or deliveries directly'
);
select ok(
	has_function_privilege(
		'authenticated',
		'public.upsert_web_push_subscription(text,text,text,timestamp with time zone)',
		'EXECUTE'
	)
		and has_function_privilege(
			'authenticated',
			'public.disable_web_push_subscription(text)',
			'EXECUTE'
		)
		and has_function_privilege(
			'authenticated',
			'public.acknowledge_web_push_inbox(text)',
			'EXECUTE'
		)
		and has_function_privilege(
			'authenticated',
			'public.get_web_push_subscription_status(text)',
			'EXECUTE'
		),
	'authenticated owner can invoke device subscription RPCs'
);
select ok(
	not has_function_privilege(
		'authenticated',
		'public.claim_web_push_deliveries(integer,integer)',
		'EXECUTE'
	)
		and has_function_privilege(
			'service_role',
			'public.claim_web_push_deliveries(integer,integer)',
			'EXECUTE'
		)
		and has_function_privilege(
			'service_role',
			'public.complete_web_push_delivery(bigint,uuid)',
			'EXECUTE'
		)
		and has_function_privilege(
			'service_role',
			'public.fail_web_push_delivery(bigint,uuid,text)',
			'EXECUTE'
		)
		and not has_function_privilege(
			'authenticated',
			'public.fail_web_push_delivery(bigint,uuid,text)',
			'EXECUTE'
		),
	'only service role can claim and complete deliveries'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-dispatch-web-push'
			and schedule = '*/5 * * * *'
	),
	1::bigint,
	'web push dispatcher runs every five minutes'
);
select is(
	(
		select count(*)
		from cron.job
		where jobname = 'applemint-clean-web-push'
	),
	1::bigint,
	'web push cleanup is scheduled'
);

insert into auth.users (id)
values ('480f5282-7933-4800-a970-d6bc8f05e8cb'::uuid)
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select throws_ok(
	$$
		select public.upsert_web_push_subscription(
			'https://push.test/not-owner',
			'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			'BBBBBBBBBBBBBBBBBBBBBB',
			null
		)
	$$,
	'42501',
	'Only the Applemint owner can manage web push subscriptions.',
	'non-owner cannot create a push subscription'
);
select throws_ok(
	$$
		select public.get_web_push_subscription_status('https://push.test/not-owner')
	$$,
	'42501',
	'Only the Applemint owner can inspect web push subscriptions.',
	'non-owner cannot inspect a push subscription'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	$$
		select public.upsert_web_push_subscription(
			'https://push.test/device-a',
			'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			'BBBBBBBBBBBBBBBBBBBBBB',
			null
		)
	$$,
	'owner can activate the first device'
);
select lives_ok(
	$$
		select public.upsert_web_push_subscription(
			'https://push.test/device-b',
			'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
			'DDDDDDDDDDDDDDDDDDDDDD',
			null
		)
	$$,
	'owner can activate a second independent device'
);
select is(
	public.get_web_push_subscription_status('https://push.test/device-a') ->> 'active',
	'true',
	'owner sees an active server subscription for the current endpoint'
);
reset role;

select is(
	(select count(*) from public.web_push_subscriptions where active),
	2::bigint,
	'two active device subscriptions are stored'
);
select ok(
	(select min(last_seen_at) from public.web_push_subscriptions) >= now() - interval '1 minute',
	'new subscriptions start their badge window at activation time'
);

insert into public.crawl_runs (
	id,
	source,
	lock_token,
	status,
	started_at,
	stale_after,
	run_trigger
)
values
	(
		910001,
		'battlepage',
		'91000000-0000-4000-8000-000000000001',
		'running',
		now() - interval '1 minute',
		now() + interval '5 minutes',
		'scheduled'
	),
	(
		910002,
		'arcalive',
		'91000000-0000-4000-8000-000000000002',
		'running',
		now() - interval '1 minute',
		now() + interval '5 minutes',
		'scheduled'
	),
	(
		910003,
		'insagirl',
		'91000000-0000-4000-8000-000000000003',
		'running',
		now() - interval '1 minute',
		now() + interval '5 minutes',
		'manual'
	),
	(
		910004,
		'battlepage',
		'91000000-0000-4000-8000-000000000004',
		'running',
		now() - interval '1 minute',
		now() + interval '5 minutes',
		'scheduled'
	),
	(
		910005,
		'arcalive',
		'91000000-0000-4000-8000-000000000005',
		'running',
		now() - interval '1 minute',
		now() + interval '5 minutes',
		'scheduled'
	);

set local role service_role;
select public.finish_crawl_run(
	910001,
	'91000000-0000-4000-8000-000000000001',
	'{"status":"succeeded","insertedCount":12}'::jsonb
);
select public.finish_crawl_run(
	910002,
	'91000000-0000-4000-8000-000000000002',
	'{"status":"partial","insertedCount":3}'::jsonb
);
select public.finish_crawl_run(
	910003,
	'91000000-0000-4000-8000-000000000003',
	'{"status":"succeeded","insertedCount":8}'::jsonb
);
select public.finish_crawl_run(
	910004,
	'91000000-0000-4000-8000-000000000004',
	'{"status":"succeeded","insertedCount":0}'::jsonb
);
select public.finish_crawl_run(
	910005,
	'91000000-0000-4000-8000-000000000005',
	'{"status":"failed","insertedCount":7}'::jsonb
);
reset role;

select is(
	(select count(*) from public.web_push_deliveries),
	4::bigint,
	'only scheduled succeeded or partial runs with inserted items create deliveries'
);
select is(
	(
		select jsonb_object_agg(run_id::text, delivery_count)
		from (
			select run_id, count(*) as delivery_count
			from public.web_push_deliveries
			group by run_id
		) as per_run
	),
	'{"910001":2,"910002":2}'::jsonb,
	'each eligible run creates one delivery per active device'
);
select is(
	(
		select count(*)
		from public.web_push_deliveries
		where run_id in (910003, 910004, 910005)
	),
	0::bigint,
	'manual, zero-item, and failed runs do not create deliveries'
);

set local role service_role;
select throws_ok(
	$$
		select public.finish_crawl_run(
			910001,
			'91000000-0000-4000-8000-000000000001',
			'{"status":"succeeded","insertedCount":12}'::jsonb
		)
	$$,
	'P0002',
	'Running crawl run was not found.',
	'a duplicate finish cannot duplicate deliveries'
);
reset role;
select is(
	(select count(*) from public.web_push_deliveries),
	4::bigint,
	'run and subscription uniqueness remains intact after duplicate finish'
);

-- Use a realistic later badge window inside this single pgTAP transaction.
update public.web_push_subscriptions
set last_seen_at = now() - interval '1 minute';

create temporary table claimed_first as
select *
from public.claim_web_push_deliveries(1, 120);
create temporary table claimed_rest as
select *
from public.claim_web_push_deliveries(20, 120);
grant select on claimed_first, claimed_rest to service_role;

select is(
	(select count(*) from claimed_first),
	1::bigint,
	'first worker claim respects its batch limit'
);
select is(
	(select count(*) from claimed_rest),
	3::bigint,
	'a concurrent claim skips the already leased delivery'
);
select is(
	(select min(badge_count) from claimed_first),
	15::bigint,
	'first device badge sums inserted items since its last Inbox acknowledgement'
);
select is(
	(select min(badge_count) from claimed_rest),
	15::bigint,
	'each claimed delivery carries the independent cumulative device badge'
);

set local role service_role;
select ok(
	public.complete_web_push_delivery(
		(select delivery_id from claimed_first),
		(select delivery_lease_token from claimed_first)
	),
	'a matching lease completes a delivery'
);
select public.retry_web_push_delivery(
	(
		select delivery_id
		from claimed_rest
		where endpoint = 'https://push.test/device-a'
		order by delivery_id
		limit 1
	),
	(
		select delivery_lease_token
		from claimed_rest
		where endpoint = 'https://push.test/device-a'
		order by delivery_id
		limit 1
	),
	'network-error'
);
reset role;

select is(
	(
		select state
		from public.web_push_deliveries
		where id = (
			select delivery_id
			from claimed_rest
			where endpoint = 'https://push.test/device-a'
			order by delivery_id
			limit 1
		)
	),
	'retry',
	'transient delivery failure returns to retry'
);
select ok(
	(
		select available_at between now() + interval '55 seconds' and now() + interval '65 seconds'
		from public.web_push_deliveries
		where id = (
			select delivery_id
			from claimed_rest
			where endpoint = 'https://push.test/device-a'
			order by delivery_id
			limit 1
		)
	),
	'first retry uses the one-minute backoff'
);

set local role service_role;
select public.invalidate_web_push_subscription(
	(
		select delivery_id
		from claimed_rest
		where endpoint = 'https://push.test/device-b'
		order by delivery_id
		limit 1
	),
	(
		select delivery_lease_token
		from claimed_rest
		where endpoint = 'https://push.test/device-b'
		order by delivery_id
		limit 1
	),
	'push-410'
);
reset role;

select ok(
	not (
		select active
		from public.web_push_subscriptions
		where endpoint = 'https://push.test/device-b'
	),
	'404 or 410 invalidates only the affected device subscription'
);
select is(
	(
		select count(*)
		from public.web_push_deliveries as delivery
		inner join public.web_push_subscriptions as subscription
			on subscription.id = delivery.subscription_id
		where subscription.endpoint = 'https://push.test/device-b'
			and delivery.state = 'skipped'
	),
	1::bigint,
	'invalidation skips the affected device remaining delivery'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	$$
		select public.acknowledge_web_push_inbox('https://push.test/device-a')
	$$,
	'Inbox acknowledgement succeeds for the current active device'
);
reset role;

select is(
	(
		select count(*)
		from public.web_push_deliveries as delivery
		inner join public.web_push_subscriptions as subscription
			on subscription.id = delivery.subscription_id
		where subscription.endpoint = 'https://push.test/device-a'
			and delivery.state in ('pending', 'retry', 'processing')
	),
	0::bigint,
	'Inbox acknowledgement skips every unsent delivery for that device'
);
select ok(
	(
		select last_seen_at >= now() - interval '1 minute'
		from public.web_push_subscriptions
		where endpoint = 'https://push.test/device-a'
	),
	'Inbox acknowledgement advances only that device badge window'
);

-- Expired processing leases become claimable again without duplicating rows.
update public.web_push_subscriptions
set active = true, disabled_at = null, last_seen_at = now() - interval '1 minute'
where endpoint = 'https://push.test/device-b';
update public.web_push_deliveries
set
	state = 'processing',
	lease_token = '92000000-0000-4000-8000-000000000001',
	lease_expires_at = now() - interval '1 second',
	attempt_count = 1,
	last_error_code = null
where id = (
	select delivery.id
	from public.web_push_deliveries as delivery
	inner join public.web_push_subscriptions as subscription
		on subscription.id = delivery.subscription_id
	where subscription.endpoint = 'https://push.test/device-b'
		and delivery.state = 'skipped'
	order by delivery.id desc
	limit 1
);

create temporary table reclaimed_delivery as
select *
from public.claim_web_push_deliveries(20, 120);
grant select on reclaimed_delivery to service_role;

select is(
	(select count(*) from reclaimed_delivery),
	1::bigint,
	'an expired lease is recovered by the next claim'
);
select is(
	(select count(*) from public.web_push_deliveries),
	4::bigint,
	'lease recovery never creates a duplicate delivery'
);

set local role service_role;
select is(
	(
		public.retry_web_push_delivery(
			(select delivery_id from reclaimed_delivery),
			(select delivery_lease_token from reclaimed_delivery),
			'push-network'
		) ->> 'state'
	),
	'retry',
	'a recovered lease continues with the next retry backoff'
);
reset role;

update public.web_push_deliveries
set
	state = 'processing',
	lease_token = '92000000-0000-4000-8000-000000000002',
	lease_expires_at = now() + interval '2 minutes',
	attempt_count = 6,
	last_error_code = null
where id = (select delivery_id from reclaimed_delivery);

set local role service_role;
select is(
	(
		public.retry_web_push_delivery(
			(select delivery_id from reclaimed_delivery),
			'92000000-0000-4000-8000-000000000002',
			'push-network'
		) ->> 'state'
	),
	'dead',
	'the sixth failed attempt reaches the dead terminal state'
);
reset role;

update public.web_push_deliveries
set
	state = 'pending',
	available_at = now() - interval '25 hours',
	lease_token = null,
	lease_expires_at = null,
	delivered_at = null,
	created_at = now() - interval '25 hours',
	updated_at = now() - interval '25 hours',
	last_error_code = null
where id = (select delivery_id from claimed_first);

select is(
	(select count(*) from public.claim_web_push_deliveries(20, 120)),
	0::bigint,
	'a delivery older than 24 hours is never claimed'
);
select is(
	(
		select state
		from public.web_push_deliveries
		where id = (select delivery_id from claimed_first)
	),
	'dead',
	'a delivery older than 24 hours is marked dead'
);

-- An exhausted expired lease must not poison the queue or block a healthy claim.
update public.web_push_deliveries
set
	state = 'processing',
	lease_token = '92000000-0000-4000-8000-000000000003',
	lease_expires_at = now() - interval '1 second',
	attempt_count = 6,
	delivered_at = null,
	last_error_code = null
where id = (select delivery_id from reclaimed_delivery);

insert into public.web_push_deliveries (
	run_id,
	subscription_id,
	source,
	inserted_count
)
select
	910004,
	subscription.id,
	'battlepage',
	2
from public.web_push_subscriptions as subscription
where subscription.endpoint = 'https://push.test/device-a';

select lives_ok(
	$$
		create temporary table hardened_claim as
		select *
		from public.claim_web_push_deliveries(20, 120)
	$$,
	'an exhausted expired lease does not abort the next queue claim'
);
grant select on hardened_claim to service_role;

select is(
	(select count(*) from hardened_claim),
	1::bigint,
	'the healthy pending delivery is still claimed'
);
select is(
	(
		select state || ':' || last_error_code
		from public.web_push_deliveries
		where id = (select delivery_id from reclaimed_delivery)
	),
	'dead:retry-exhausted',
	'the exhausted expired lease is finalized without incrementing past the constraint'
);

set local role service_role;
select ok(
	public.fail_web_push_delivery(
		(select delivery_id from hardened_claim),
		(select delivery_lease_token from hardened_claim),
		'push-400'
	),
	'a permanent push failure finalizes the matching lease'
);
reset role;
select is(
	(
		select state || ':' || last_error_code
		from public.web_push_deliveries
		where id = (select delivery_id from hardened_claim)
	),
	'dead:push-400',
	'a permanent push failure is terminal instead of retryable'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '480f5282-7933-4800-a970-d6bc8f05e8cb', true);
select lives_ok(
	$$
		select public.upsert_web_push_subscription(
			'https://push.test/device-expired',
			'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
			'FFFFFFFFFFFFFFFFFFFFFF',
			now() - interval '1 minute'
		)
	$$,
	'an expired browser subscription fixture can be registered'
);
reset role;

insert into public.web_push_deliveries (
	run_id,
	subscription_id,
	source,
	inserted_count
)
select
	910005,
	subscription.id,
	'arcalive',
	4
from public.web_push_subscriptions as subscription
where subscription.endpoint = 'https://push.test/device-expired';

select is(
	public.dispatch_due_web_push_notifications() ->> 'status',
	'idle',
	'expired subscriptions are cleaned without dispatching an external request'
);
select is(
	(
		select active::text || ':' || (disabled_at is not null)::text
		from public.web_push_subscriptions
		where endpoint = 'https://push.test/device-expired'
	),
	'false:true',
	'an expired subscription is deactivated'
);
select is(
	(
		select state || ':' || last_error_code
		from public.web_push_deliveries as delivery
		inner join public.web_push_subscriptions as subscription
			on subscription.id = delivery.subscription_id
		where subscription.endpoint = 'https://push.test/device-expired'
	),
	'skipped:subscription-expired',
	'expired subscription deliveries are terminally skipped'
);

select * from finish();
rollback;
