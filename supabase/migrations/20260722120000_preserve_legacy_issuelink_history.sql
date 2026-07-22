-- IssueLink 신규 실행은 함수 allowlist로 차단하되 완료된 실행·복구된 incident 이력은 보존한다.
-- 20260722110000이 먼저 적용된 환경도 동일한 보존 정책으로 수렴시킨다.
alter table public.crawl_runs drop constraint crawl_runs_source_check;
alter table public.crawl_runs add constraint crawl_runs_source_check
	check (source in ('arcalive', 'battlepage', 'insagirl', 'issuelink'));

alter table public.crawl_alert_incidents drop constraint crawl_alert_incidents_source_check;
alter table public.crawl_alert_incidents add constraint crawl_alert_incidents_source_check
	check (source in ('arcalive', 'battlepage', 'insagirl', 'issuelink'));
