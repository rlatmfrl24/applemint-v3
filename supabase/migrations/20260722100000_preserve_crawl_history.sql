-- crawl-history는 사용자 목록과 별개로 영구 중복 방지 키를 보존한다.
revoke all on table public."crawl-history" from service_role;
grant select, insert on table public."crawl-history" to service_role;

revoke all on sequence public."crawl-history_id_seq" from service_role;
grant usage, select on sequence public."crawl-history_id_seq" to service_role;
