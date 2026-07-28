begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.get_web_push_subscription_status(
	p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_user_id uuid := auth.uid();
	v_active boolean;
begin
	if not public.is_applemint_owner() or v_user_id is null then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can inspect web push subscriptions.';
	end if;
	if p_endpoint is null
		or octet_length(p_endpoint) not between 16 and 4096
		or p_endpoint !~ '^https://'
	then
		raise exception using
			errcode = '22023',
			message = 'Invalid web push endpoint.';
	end if;

	select coalesce(
		subscription.active
			and (
				subscription.expiration_time is null
				or subscription.expiration_time > now()
			),
		false
	)
	into v_active
	from public.web_push_subscriptions as subscription
	where subscription.user_id = v_user_id
		and subscription.endpoint = p_endpoint;

	return jsonb_build_object('active', coalesce(v_active, false));
end;
$$;

create or replace function public.claim_web_push_deliveries(
	p_limit integer default 20,
	p_lease_seconds integer default 120
)
returns table (
	delivery_id bigint,
	delivery_lease_token uuid,
	subscription_id bigint,
	endpoint text,
	p256dh text,
	auth text,
	expiration_time timestamp with time zone,
	run_id text,
	source text,
	inserted_count integer,
	badge_count bigint,
	created_at timestamp with time zone
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_lease_token uuid := gen_random_uuid();
begin
	if p_limit < 1 or p_limit > 20 then
		raise exception using
			errcode = '22023',
			message = 'Web push claim limit must be between 1 and 20.';
	end if;
	if p_lease_seconds < 30 or p_lease_seconds > 600 then
		raise exception using
			errcode = '22023',
			message = 'Web push lease must be between 30 and 600 seconds.';
	end if;

	update public.web_push_subscriptions as subscription
	set
		active = false,
		disabled_at = v_now,
		updated_at = v_now
	where subscription.active
		and subscription.expiration_time <= v_now;

	update public.web_push_deliveries as delivery
	set
		state = 'skipped',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = 'subscription-expired',
		updated_at = v_now
	from public.web_push_subscriptions as subscription
	where subscription.id = delivery.subscription_id
		and subscription.expiration_time <= v_now
		and delivery.state in ('pending', 'retry', 'processing');

	update public.web_push_deliveries as delivery
	set
		state = case
			when delivery.attempt_count >= 6
				or delivery.created_at <= v_now - interval '24 hours'
				then 'dead'
			else 'retry'
		end,
		available_at = v_now,
		lease_token = null,
		lease_expires_at = null,
		last_error_code = case
			when delivery.attempt_count >= 6
				then 'retry-exhausted'
			when delivery.created_at <= v_now - interval '24 hours'
				then 'delivery-expired'
			else 'lease-expired'
		end,
		updated_at = v_now
	where delivery.state = 'processing'
		and delivery.lease_expires_at <= v_now;

	update public.web_push_deliveries as delivery
	set
		state = 'dead',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = case
			when delivery.attempt_count >= 6
				then 'retry-exhausted'
			else 'delivery-expired'
		end,
		updated_at = v_now
	where delivery.state in ('pending', 'retry')
		and (
			delivery.attempt_count >= 6
			or delivery.created_at <= v_now - interval '24 hours'
		);

	return query
	with candidates as (
		select delivery.id
		from public.web_push_deliveries as delivery
		inner join public.web_push_subscriptions as subscription
			on subscription.id = delivery.subscription_id
		where delivery.state in ('pending', 'retry')
			and delivery.available_at <= v_now
			and delivery.created_at > v_now - interval '24 hours'
			and delivery.attempt_count < 6
			and subscription.active
			and (
				subscription.expiration_time is null
				or subscription.expiration_time > v_now
			)
		order by delivery.available_at, delivery.id
		for update of delivery skip locked
		limit p_limit
	),
	claimed as (
		update public.web_push_deliveries as delivery
		set
			state = 'processing',
			lease_token = v_lease_token,
			lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
			attempt_count = delivery.attempt_count + 1,
			updated_at = v_now
		from candidates
		where delivery.id = candidates.id
		returning delivery.*
	)
	select
		claimed.id,
		claimed.lease_token,
		subscription.id,
		subscription.endpoint,
		subscription.p256dh,
		subscription.auth,
		subscription.expiration_time,
		claimed.run_id::text,
		claimed.source,
		claimed.inserted_count,
		coalesce(badge.total, 0),
		claimed.created_at
	from claimed
	inner join public.web_push_subscriptions as subscription
		on subscription.id = claimed.subscription_id
	left join lateral (
		select sum(delivery.inserted_count)::bigint as total
		from public.web_push_deliveries as delivery
		where delivery.subscription_id = subscription.id
			and delivery.created_at > subscription.last_seen_at
			and delivery.state <> 'skipped'
	) as badge on true
	order by claimed.id;
end;
$$;

create or replace function public.fail_web_push_delivery(
	p_delivery_id bigint,
	p_lease_token uuid,
	p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_updated boolean;
begin
	if p_error_code is null
		or octet_length(p_error_code) not between 1 and 80
		or p_error_code !~ '^[a-z0-9-]+$'
	then
		raise exception using
			errcode = '22023',
			message = 'Invalid web push error code.';
	end if;

	update public.web_push_deliveries
	set
		state = 'dead',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = p_error_code,
		updated_at = now()
	where id = p_delivery_id
		and lease_token = p_lease_token
		and state = 'processing'
	returning true into v_updated;

	return coalesce(v_updated, false);
end;
$$;

create or replace function public.dispatch_due_web_push_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_base_url text;
	v_internal_secret text;
	v_request_id bigint;
begin
	perform pg_catalog.pg_advisory_xact_lock(
		pg_catalog.hashtextextended('applemint:web-push-dispatch', 0)
	);

	update public.web_push_subscriptions as subscription
	set
		active = false,
		disabled_at = v_now,
		updated_at = v_now
	where subscription.active
		and subscription.expiration_time <= v_now;

	update public.web_push_deliveries as delivery
	set
		state = 'skipped',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = 'subscription-expired',
		updated_at = v_now
	from public.web_push_subscriptions as subscription
	where subscription.id = delivery.subscription_id
		and subscription.expiration_time <= v_now
		and delivery.state in ('pending', 'retry', 'processing');

	if not exists (
		select 1
		from public.web_push_deliveries as delivery
		inner join public.web_push_subscriptions as subscription
			on subscription.id = delivery.subscription_id
		where subscription.active
			and (
				subscription.expiration_time is null
				or subscription.expiration_time > v_now
			)
			and (
				(
					delivery.state in ('pending', 'retry')
					and delivery.available_at <= v_now
				)
				or (
					delivery.state = 'processing'
					and delivery.lease_expires_at <= v_now
				)
			)
	) then
		return jsonb_build_object('status', 'idle');
	end if;

	select secret.decrypted_secret
	into v_base_url
	from vault.decrypted_secrets as secret
	where secret.name = 'crawl_app_base_url'
	order by secret.created_at desc
	limit 1;

	select secret.decrypted_secret
	into v_internal_secret
	from vault.decrypted_secrets as secret
	where secret.name = 'crawl_internal_secret'
	order by secret.created_at desc
	limit 1;

	v_base_url := rtrim(v_base_url, '/');
	if v_base_url is null
		or v_base_url !~ '^https?://[^[:space:]]+$'
		or v_internal_secret is null
		or octet_length(v_internal_secret) < 32
	then
		return jsonb_build_object('status', 'configuration-missing');
	end if;

	select net.http_post(
		url := v_base_url || '/api/push/dispatch',
		headers := jsonb_build_object(
			'Content-Type', 'application/json',
			'x-applemint-internal-secret', v_internal_secret
		),
		body := jsonb_build_object('limit', 20),
		timeout_milliseconds := 60000
	)
	into v_request_id;

	return jsonb_build_object('status', 'dispatched', 'requestId', v_request_id);
end;
$$;

revoke all on function public.get_web_push_subscription_status(text)
	from public, anon, authenticated, service_role;
revoke all on function public.fail_web_push_delivery(bigint, uuid, text)
	from public, anon, authenticated, service_role;

grant execute on function public.get_web_push_subscription_status(text)
	to authenticated;
grant execute on function public.fail_web_push_delivery(bigint, uuid, text)
	to service_role;

commit;
