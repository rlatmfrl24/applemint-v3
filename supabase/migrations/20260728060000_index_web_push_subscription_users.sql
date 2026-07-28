begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index web_push_subscriptions_user_id_idx
	on public.web_push_subscriptions (user_id);

commit;
