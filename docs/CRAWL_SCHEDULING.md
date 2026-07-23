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
보내지 않습니다.

예약 API가 `401`, `403`을 반환하거나 `configuration-missing`, `configuration-invalid` 사유를
반환하면 reconciler는 secret 또는 접근 정책 불일치로 판단해 `scheduler_enabled=false`로 예약을
자동 중지합니다. 수동 수집은 계속 사용할 수 있습니다. Vault와 Vercel의
`CRAWL_INTERNAL_SECRET`을 동일하게 맞춘 뒤 스모크 테스트를 통과해야 다시 활성화합니다.
`404`는 애플리케이션 배포 불일치로 보고 감사 로그에 `endpoint-not-found`로 기록하되
예약을 자동 중지하지 않습니다.

## 중지와 복구

예약 실행 주체는 Supabase 하나입니다. 장애가 발생하면 `crawl_runtime_settings.scheduler_enabled`를
`false`로 바꿔 신규 예약을 즉시 중지합니다. 실행 중인 작업은 source lock과 heartbeat 계약에 따라
종료되며, 설정 화면의 수동 수집은 계속 사용할 수 있습니다. Vault와 Next 환경 변수의 secret을
교정하고 `/api/crawl/scheduled` 스모크 테스트와 dispatcher 정산을 확인한 뒤 scheduler를 다시
활성화합니다.

## 실패·복구

- 페이지 또는 endpoint가 실패하면 그 작업만 1초 후 한 번 재시도합니다.
- 재시도로 복구된 failure와 warning은 alert 판정에서 제외하고 `recovered_count`에 기록합니다.
- heartbeat 소유권 상실 또는 연속 두 번의 heartbeat 오류는 현재 실행을 중단합니다.
- 비정상 종료된 실행은 lock 만료 후 재실행할 수 있고 `recover_stale_crawl_runs`가 이력을
  `interrupted`로 정리합니다.

## 배포·스모크 테스트

1. DB migration을 적용하되 `scheduler_enabled=false`를 유지합니다.
2. Vault의 `crawl_app_base_url`, `crawl_internal_secret`과 Next의 `CRAWL_INTERNAL_SECRET`을 등록합니다.
3. 설정 화면에서 소스 하나를 수동 실행해 run, lock, 적재가 정상인지 확인합니다.
4. DB에서 `dispatch_due_crawl_sources()`를 한 번 호출하고 `crawl_schedule_dispatches` 결과가 정산되는지 확인합니다.
5. `scheduler_enabled=true`로 전환합니다.
6. 72시간 동안 중복 실행, 누락, 5분 이상의 일정 지연, lock 잔존 여부를 관찰합니다.
7. 7일 후 소스별 최종 실패율, 재시도 복구율, 신규 저장량을 기준으로 주기를 재평가합니다.

문제가 생기면 먼저 `scheduler_enabled=false`로 Supabase 예약을 중단하고
Vault·Next secret과 최근 dispatch 응답을 교정합니다. 수동 실행은 계속 사용할 수 있습니다.

## DB 작업 큐 도입 기준

현재 세 소스는 serverless 실행 예산 안이므로 별도 작업 큐를 두지 않습니다. 다음 조건 중 하나가
필요해지면 `available_at`, lease owner, attempt 수, 우선순위를 가진 DB queue와 다중 worker로
전환합니다.

- 단일 소스 작업이 45초 예산을 반복해서 초과함
- 배포나 프로세스 종료 후에도 개별 지연 재시도를 보존해야 함
- 소스 수 증가로 우선순위·공정성·backpressure가 필요함
- 여러 worker가 durable job을 경쟁적으로 가져가야 함
