create or replace function public.bulk_move_new_threads_to_trash()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_moved_count bigint;
begin
	if not public.is_applemint_owner() then
		raise exception using
			errcode = '42501',
			message = 'Only the Applemint owner can move threads.';
	end if;

	with moved as (
		delete from public."new-threads"
		where id is not null
		returning type, url, title, description, host, tag, captured_at
	)
	insert into public.trash (
		type, url, title, description, host, tag, captured_at
	)
	select type, url, title, description, host, tag, captured_at
	from moved;

	get diagnostics v_moved_count = row_count;
	return v_moved_count;
end;
$$;

revoke all on function public.bulk_move_new_threads_to_trash() from public, anon, service_role;
grant execute on function public.bulk_move_new_threads_to_trash() to authenticated;
