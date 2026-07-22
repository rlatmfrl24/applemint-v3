# 크롤러 예약 실행·잠금 운영 가이드

## 기본 정책

- 활성 소스와 초기 최소 실행 간격은 `arcalive` 2시간, `battlepage` 4시간, `insagirl` 3시간입니다.
- 소스 실행 예산은 45초이며, 서로 다른 소스는 최대 2개까지 동시에 실행합니다.
- 동일 소스 중복 실행은 `crawl:<source>` 잠금으로 차단합니다.
- 수동 실행은 예약 cooldown과 `schedule_enabled`만 우회합니다.
- 잠금 TTL은 60초이고 실행 중에는 15초마다 heartbeat로 갱신합니다.

소유자는 `/main/setting/crawling`에서 소스별 예약 활성 여부와 30분~7일 범위의 주기를 수정할 수
있습니다. DB의 `recommended_cooldown_seconds`는 운영 권장 기준이며 “권장값 복원”에 사용합니다.
화면의 “다음 예상 실행”은 cooldown 종료를 다음 5분 Cron 경계로 올림한 시각입니다. 동시성이나
전송 지연이 있으면 실제 시작은 늦어질 수 있습니다.

## Supabase 예약 자동화

`crawl_runtime_settings.scheduler_enabled`가 정기 예약의 최종 스위치입니다. 기본값은 `false`이며
배포 검증과 Vault 구성이 끝난 뒤에만 활성화합니다.

- `applemint-dispatch-due-crawl-sources`: 5분마다 만료 실행을 복구하고 실행 가능한 소스를 최대
  가용 동시성만큼 `pg_net`으로 `/api/crawl/scheduled`에 전달합니다.
- `applemint-reconcile-crawl-dispatches`: 1분마다 HTTP 결과를 `crawl_schedule_dispatches`에 반영하고
  2분 이상 결과가 없는 요청을 `expired`로 처리합니다.
- `applemint-clean-crawl-dispatches`: 매일 30일이 지난 dispatch 감사 이력을 제거합니다.

같은 `(scheduled_for, source)`는 한 번만 기록됩니다. 이 테이블은 전송 감사 로그이며 lease와
attempt를 가진 작업 큐가 아닙니다. URL과 secret은 migration에 넣지 않고 Supabase Vault에 아래
이름으로 등록합니다.

- `crawl_app_base_url`: 운영 Next 애플리케이션 origin
- `crawl_internal_secret`: Next의 `CRAWL_INTERNAL_SECRET`과 같은 32바이트 이상 값

Vault 값이 없거나 올바르지 않으면 dispatcher는 `configuration-missing`으로 종료하고 외부 요청을
보내지 않습니다. Next 운영 환경의 `CRAWL_EXECUTION_MODE`는 `next`로 설정합니다.

예약 API가 `401` 또는 `403`을 반환하면 reconciler는 secret 또는 접근 정책 불일치로 판단해
`scheduler_enabled=false`로 예약을 자동 중지합니다. 수동 수집은 계속 사용할 수 있습니다. Vault와
Vercel의 `CRAWL_INTERNAL_SECRET`을 동일하게 맞춘 뒤 스모크 테스트를 통과해야 다시 활성화합니다.
`404`는 배포 전환 중 일시적으로 발생할 수 있으므로 감사 로그에 `endpoint-not-found`로 기록하되
예약을 자동 중지하지 않습니다.

## GitHub Actions 전환과 복구

전환 기간에는 `.github/workflows/crawler-schedule.yml`의 cron을 남겨두되 repository variable
`CRAWL_SCHEDULER_OWNER`로 실행 주체를 제어합니다.

- `github`: 기존 GitHub cron이 동작합니다.
- `supabase` 또는 미설정: 예약 이벤트는 건너뛰고 `workflow_dispatch` 수동 실행만 허용합니다.

변수가 누락된 상태에서는 두 예약 주체가 동시에 동작하지 않도록 fail-closed로 처리합니다. GitHub
cron으로 rollback할 때는 `CRAWL_SCHEDULER_OWNER=github`을 명시적으로 설정합니다.

수동 복구를 위해 repository variable `APP_BASE_URL`과 secret `CRAWL_INTERNAL_SECRET`을 유지합니다.
Supabase 예약을 72시간 관찰한 뒤 문제가 없으면 workflow의 `schedule` 트리거를 별도 정리 배포에서
제거하고 `workflow_dispatch`만 남깁니다.

## 실패·복구

- 페이지 또는 endpoint가 실패하면 그 작업만 1초 후 한 번 재시도합니다.
- 재시도로 복구된 failure와 warning은 alert 판정에서 제외하고 `recovered_count`에 기록합니다.
- heartbeat 소유권 상실 또는 연속 두 번의 heartbeat 오류는 현재 실행을 중단합니다.
- 비정상 종료된 실행은 lock 만료 후 재실행할 수 있고 `recover_stale_crawl_runs`가 이력을
  `interrupted`로 정리합니다.

## 배포·스모크 테스트

1. DB migration을 적용하되 `scheduler_enabled=false`를 유지합니다.
2. Vault에 두 값을 등록하고 Next를 `CRAWL_EXECUTION_MODE=next`로 배포합니다.
3. GitHub **Crawler Schedule > Run workflow**로 예약 API, run, dispatch 연결을 확인합니다.
4. DB에서 dispatcher를 한 번 수동 호출해 `crawl_schedule_dispatches` 결과가 정산되는지 확인합니다.
5. `scheduler_enabled=true`로 전환한 직후 `CRAWL_SCHEDULER_OWNER=supabase`로 변경합니다.
6. 72시간 동안 중복 실행, 누락, 5분 이상의 일정 지연, lock 잔존 여부를 관찰합니다.
7. 7일 후 소스별 최종 실패율, 재시도 복구율, 신규 저장량을 기준으로 주기를 재평가합니다.

문제가 생기면 먼저 `scheduler_enabled=false`로 Supabase 예약을 중단하고
`CRAWL_SCHEDULER_OWNER=github`으로 되돌립니다. 수동 실행은 계속 사용할 수 있습니다.

## DB 작업 큐 도입 기준

현재 세 소스는 serverless 실행 예산 안이므로 별도 작업 큐를 두지 않습니다. 다음 조건 중 하나가
필요해지면 `available_at`, lease owner, attempt 수, 우선순위를 가진 DB queue와 다중 worker로
전환합니다.

- 단일 소스 작업이 45초 예산을 반복해서 초과함
- 배포나 프로세스 종료 후에도 개별 지연 재시도를 보존해야 함
- 소스 수 증가로 우선순위·공정성·backpressure가 필요함
- 여러 worker가 durable job을 경쟁적으로 가져가야 함
