begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.web_push_subscriptions
	add column last_test_requested_at timestamp with time zone;

create or replace function public.claim_web_push_test_subscription(
	p_endpoint text,
	p_cooldown_seconds integer default 60
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_subscription public.web_push_subscriptions%rowtype;
	v_retry_after_seconds integer;
begin
	if p_endpoint is null
		or octet_length(p_endpoint) not between 16 and 4096
		or p_endpoint !~ '^https://'
	then
		raise exception using
			errcode = '22023',
			message = 'Invalid web push endpoint.';
	end if;
	if p_cooldown_seconds < 1 or p_cooldown_seconds > 600 then
		raise exception using
			errcode = '22023',
			message = 'Web push test cooldown must be between 1 and 600 seconds.';
	end if;

	select subscription.*
	into v_subscription
	from public.web_push_subscriptions as subscription
	where subscription.endpoint = p_endpoint
	for update;

	if v_subscription.id is null then
		return jsonb_build_object('status', 'not-found');
	end if;
	if not v_subscription.active then
		return jsonb_build_object('status', 'inactive');
	end if;

	if v_subscription.expiration_time is not null
		and v_subscription.expiration_time <= v_now
	then
		update public.web_push_subscriptions
		set
			active = false,
			disabled_at = v_now,
			updated_at = v_now
		where id = v_subscription.id;

		update public.web_push_deliveries
		set
			state = 'skipped',
			lease_token = null,
			lease_expires_at = null,
			last_error_code = 'subscription-expired',
			updated_at = v_now
		where subscription_id = v_subscription.id
			and state in ('pending', 'retry', 'processing');

		return jsonb_build_object('status', 'expired');
	end if;

	if v_subscription.last_test_requested_at is not null
		and v_subscription.last_test_requested_at
			> v_now - make_interval(secs => p_cooldown_seconds)
	then
		v_retry_after_seconds := greatest(
			1,
			ceil(
				extract(
					epoch from (
						v_subscription.last_test_requested_at
						+ make_interval(secs => p_cooldown_seconds)
						- v_now
					)
				)
			)::integer
		);
		return jsonb_build_object(
			'status', 'cooldown',
			'retryAfterSeconds', v_retry_after_seconds
		);
	end if;

	update public.web_push_subscriptions
	set
		last_test_requested_at = v_now,
		updated_at = v_now
	where id = v_subscription.id;

	return jsonb_build_object(
		'status', 'claimed',
		'subscriptionId', v_subscription.id,
		'endpoint', v_subscription.endpoint,
		'p256dh', v_subscription.p256dh,
		'auth', v_subscription.auth
	);
end;
$$;

create or replace function public.invalidate_web_push_test_subscription(
	p_subscription_id bigint,
	p_error_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
	v_now timestamp with time zone := now();
	v_subscription_id bigint;
	v_skipped_count integer := 0;
begin
	if p_subscription_id is null or p_subscription_id <= 0 then
		raise exception using
			errcode = '22023',
			message = 'Invalid web push subscription id.';
	end if;
	if p_error_code not in ('push-404', 'push-410') then
		raise exception using
			errcode = '22023',
			message = 'Unsupported web push invalidation code.';
	end if;

	select subscription.id
	into v_subscription_id
	from public.web_push_subscriptions as subscription
	where subscription.id = p_subscription_id
	for update;

	if v_subscription_id is null then
		return jsonb_build_object('invalidated', false, 'skippedCount', 0);
	end if;

	update public.web_push_subscriptions
	set
		active = false,
		disabled_at = coalesce(disabled_at, v_now),
		updated_at = v_now
	where id = v_subscription_id;

	update public.web_push_deliveries
	set
		state = 'skipped',
		lease_token = null,
		lease_expires_at = null,
		last_error_code = 'subscription-invalid',
		updated_at = v_now
	where subscription_id = v_subscription_id
		and state in ('pending', 'retry', 'processing');
	get diagnostics v_skipped_count = row_count;

	return jsonb_build_object(
		'invalidated', true,
		'skippedCount', v_skipped_count
	);
end;
$$;

revoke all on function public.claim_web_push_test_subscription(text, integer)
	from public, anon, authenticated, service_role;
revoke all on function public.invalidate_web_push_test_subscription(bigint, text)
	from public, anon, authenticated, service_role;

grant execute on function public.claim_web_push_test_subscription(text, integer)
	to service_role;
grant execute on function public.invalidate_web_push_test_subscription(bigint, text)
	to service_role;

commit;
