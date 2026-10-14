begin;

-- Preserve unexpected provider charges, but require reconciliation before settlement.
alter table public.bookmark_ai_reservations drop constraint bookmark_ai_reservations_check;
alter table public.bookmark_ai_reservations add constraint bookmark_ai_reservations_check
 check(charged_nano >= 0 and (charged_nano <= reserved_nano or state='uncertain'));

do $$
declare definition text; marker text; aggregate_expression text := 'case when state=''released'' then 0 when state=''settled'' then charged_nano else reserved_nano end';
begin
 definition := pg_get_functiondef('public.bookmark_ai_reserve(uuid,uuid,uuid,int,bigint)'::regprocedure);
 marker := 'if exists(select 1 from public.bookmark_ai_reservations where id=p_id)';
 if position(marker in definition)=0 or position(aggregate_expression in definition)=0 then raise exception 'budget reservation boundary changed'; end if;
 definition := replace(definition,marker,$guard$if exists(select 1 from public.bookmark_ai_reservations where month=v_month and state<>'released' and charged_nano>reserved_nano) then return false; end if;
 if exists(select 1 from public.bookmark_ai_reservations where id=p_id)$guard$);
 execute replace(definition,aggregate_expression,'case when state=''released'' then 0 when state=''settled'' then charged_nano else greatest(reserved_nano,coalesce(charged_nano,0)) end');

 definition := pg_get_functiondef('public.bookmark_snapshot(jsonb)'::regprocedure);
 if position(aggregate_expression in definition)=0 then raise exception 'budget display boundary changed'; end if;
 execute replace(definition,aggregate_expression,'case when state=''released'' then 0 when state=''settled'' then charged_nano else greatest(reserved_nano,coalesce(charged_nano,0)) end');

 definition := pg_get_functiondef('public.bookmark_worker_commit(uuid,uuid,jsonb)'::regprocedure);
 marker := 'if p_result ? ''reservationId'' then';
 if position(marker in definition)=0 then raise exception 'budget settlement boundary changed'; end if;
 -- Job -> month -> reservation is the same lock order as reservation creation.
 execute replace(definition,marker,$lock$if p_result ? 'reservationId' then
  perform pg_advisory_xact_lock(hashtextextended('bookmark:ai-budget:'||(select month from public.bookmark_ai_reservations where id=(p_result->>'reservationId')::uuid and job_id=j.id),0));$lock$);
end $$;
commit;
