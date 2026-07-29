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

## 미디어 메타데이터 worker 자동화

YouTube·Imgur 메타데이터 worker는 기존 크롤러와 별도 scheduler를 사용합니다. migration을 적용하면
아래 Cron은 등록되지만 `media_worker_runtime_settings.scheduler_enabled=false`이므로 외부 요청은
발생하지 않습니다. Imgur provider 복구 migration은 전역 scheduler와 YouTube switch를 변경하지
않고 `imgur_enabled=false`, `imgur_batch_size=1`로 배포합니다.

- `applemint-dispatch-media-workers`: 1분마다 실행 가능한 provider queue를 확인합니다.
- `applemint-reconcile-media-worker-dispatches`: 1분마다 `pg_net` 응답을 정산합니다.
- `applemint-clean-media-worker-dispatches`: 매일 03:50 KST에 30일이 지난 dispatch 감사를 제거합니다.

dispatcher는 기존 Vault의 `crawl_app_base_url`, `crawl_internal_secret`을 재사용하고 다음 내부
endpoint만 호출합니다.

- `/api/media/youtube/enrich`: 한 번에 최대 50개
- `/api/media/imgur/enrich`: 한 번에 최대 2개를 claim하고 API 요청은 항상 순차 처리. 운영
  활성화 초기값은 batch 1

Imgur는 `imgur_enrichment_cutoff_at` 이전에 수집된 항목의 metadata와 job을 보존하지 않습니다.
기존 thread와 crawl history는 그대로 두고 일반 카드로 표시하며, cutover 이후 실제로 새로 삽입된
Imgur thread만 pending metadata와 queued job을 원자적으로 생성합니다.

재수집된 URL은 `crawl-history` 충돌로 기존 thread에 합쳐지며 metadata나 job을 새로 만들지
않습니다. 스레드가 `inbox | saved`에서 Trash로 이동하면 아직 처리되지 않은 metadata와
`queued | retry | processing` job을 같은 트랜잭션에서 삭제합니다. claim RPC도 Trash 상태를
제외하므로 상태 이동과 worker claim이 인접해도 이후 retry가 이어지지 않습니다. 이미
`succeeded | dead`인 종단 job과 완료 metadata는 API를 추가 사용하지 않으므로 보존합니다.
Trash에서 inbox로 복원해도 취소된 job은 다시 생성하지 않습니다.

Vault 값은 migration이나 `media_worker_dispatches`에 저장하지 않습니다. Vault 값이 없거나
base URL·secret 형식이 올바르지 않으면 media scheduler만 즉시 비활성화하고
`configuration-missing`을 반환합니다. 기존 `crawl_runtime_settings.scheduler_enabled`는 변경하지
않습니다.

dispatch 감사 상태는 다음처럼 구분합니다.

| 응답 | `media_worker_dispatches.state` | 동작 |
| --- | --- | --- |
| 2xx | `succeeded` | transport 성공으로 기록하고 provider 결과는 `provider_outcome`에 별도 기록 |
| 401 | `authentication-error` | 해당 provider switch만 자동 중지 |
| 403 | `authorization-error` | 해당 provider switch만 자동 중지 |
| 404 | `endpoint-not-found` | 배포 불일치로 보고 해당 provider switch만 자동 중지 |
| 429 | `rate-limited` | queue와 lease를 보존하고 다음 실행에서 복구 |
| 5xx | `server-error` | queue와 lease를 보존하고 다음 실행에서 복구 |
| timeout·network | `transport-error` | 응답 정산 후 다시 dispatch 가능 |
| 2분간 응답 없음 | `expired` | 응답 감사를 만료하고 다시 dispatch 가능 |

provider를 비활성화하기 전에 전송된 요청의 오류가 늦게 도착하면 감사 상태와 사유만 정산합니다.
이미 비활성화된 provider의 늦은 응답은 계속 실행 중인 다른 provider를 중지하지 않습니다.

Route Handler가 HTTP 200을 반환해도 provider가 `rate-limited` 또는 `retrying`일 수 있습니다.
`state`는 `succeeded`로 유지하고 `provider_outcome`, 실제 `api_request_count`, 오류·HTTP 상태 집계,
`next_available_at`, `provider_cooldown_until`에서 처리 결과를 확인합니다. 집계는 key 16개와
2KB로 제한하며 30일 뒤 삭제합니다. 원시 API 응답, 전체 header, URL, credential은 저장하지
않습니다.

YouTube worker가 job을 claim한 뒤 중단되면 45초 lease가 만료된 후 같은 provider가 다시 claim할
수 있습니다. Imgur worker는 album·gallery의 순차 API 요청 시간을 고려해 최대 2개만 claim하고
API 요청 concurrency를 1로 고정하며, 중단된 job은 60초 lease 만료 후 다시 claim할 수 있습니다.
worker가 공급자 429·5xx·timeout을 확인한 경우에는 job을 `retry`로 돌리고 `available_at`까지
재claim하지 않습니다. dispatch 자체가 worker에 도달하지 못했다면 job은 `queued`로 남거나 만료
lease로 복구됩니다.

YouTube의 `quotaExceeded`, `dailyLimitExceeded` 계열은 일일 quota reset을 지나도록 25시간 뒤에
재시도합니다. 일반 오류의 5회 제한과 분리해 최대 7회까지 보존하되, 지속적인 설정·quota 문제를
무한 재시도하지는 않습니다. 403 rate-limit 계열은 일반 지수 backoff와 5회 제한을 사용합니다.

Imgur의 HTTP 429는 rate-limit header를 기준으로 구분합니다. `X-RateLimit-ClientRemaining=0`이면
25시간 cooldown을 설정합니다. `X-RateLimit-UserRemaining=0`이면 유효한 Unix epoch
`X-RateLimit-UserReset`에 5분을 더하고, 값이 없거나 유효하지 않으면 65분을 사용합니다. 그 외
429는 정수 초 또는 HTTP-date `Retry-After`, 없으면 1시간을 사용합니다. 모든 cooldown은
1분~25시간으로 제한합니다.

403은 client/user remaining이 0인 경우에만 quota retry로 처리하며, quota 신호가 없는 403은
`IMGUR_HTTP_403` 종단 오류입니다. Rate-limit은 콘텐츠 오류가 아니므로 최대 시도 수에 도달해도
job을 `dead`로 바꾸지 않고 `retry`로 보존합니다. `set_imgur_enrichment_cooldown`이 현재보다 긴
provider cooldown을 원자적으로 보존하고 queued·retry job을 같은 시각 뒤로 미룹니다. dispatcher는
cooldown 동안 Imgur만 건너뛰며 만료 후 자동 재개합니다. 같은 dispatch에서 첫 제한 응답 또는
성공 응답의 remaining 0을 확인하면 현재 성공 건은 완료하고 남은 claimed job은 API를 호출하지
않은 채 동일 cooldown으로 retry합니다.

5xx·timeout·network·invalid response는 지수 backoff와 최대 5회 정책을 유지하며 마지막 실제
오류 코드를 종단 상태에 보존합니다. 제한 중인 pending 항목은 전용 skeleton 대신 제목과 링크를
확인할 수 있는 일반 카드로 표시합니다. 과거 worker의 `IMGUR_MAX_ATTEMPTS`는 원인을 구분할 수
없으므로 실패 카드로 유지합니다. Album 응답에 preview image가 포함되어 있거나 첫 응답에서
remaining 0이 확인되면 별도 album images 요청을 생략해 API 사용량을 줄입니다.

### 운영 반영 전 읽기 전용 대조

다음 쿼리는 측정 시각과 provider별 thread·metadata·job 수를 한 번에 기록합니다.

```sql
with provider_counts as (
	select
		provider.type as provider,
		count(distinct thread.id) as thread_count,
		count(distinct metadata.thread_id) as metadata_count,
		count(distinct job.thread_id) as job_count,
		count(distinct thread.id) filter (where metadata.thread_id is null) as missing_metadata_count,
		count(distinct thread.id) filter (where job.thread_id is null) as missing_job_count
	from (values ('youtube'::text), ('imgur'::text)) as provider(type)
	left join public.threads as thread on thread.type = provider.type
	left join public.thread_media_metadata as metadata
		on metadata.thread_id = thread.id and metadata.provider = provider.type
	left join public.media_enrichment_jobs as job
		on job.thread_id = thread.id and job.provider = provider.type
	group by provider.type
)
select now() as measured_at, *
from provider_counts
order by provider;
```

`missing_metadata_count`, `missing_job_count`는 모두 0이어야 합니다. 상태별 분포도 같은 측정 시각에
기록합니다.

```sql
select
	now() as measured_at,
	job.provider,
	job.state,
	count(*) as job_count
from public.media_enrichment_jobs as job
group by job.provider, job.state
order by job.provider, job.state;
```

### queue 지연·lease 운영 조회

다음 쿼리는 pending metadata, queue 상태, 만료 lease, 가장 오래된 실행 가능 시각과 현재 최대
지연을 provider별로 보여줍니다.

```sql
select
	now() as measured_at,
	job.provider,
	count(*) filter (where metadata.status = 'pending') as pending_metadata,
	count(*) filter (where job.state = 'queued') as queued,
	count(*) filter (where job.state = 'processing') as processing,
	count(*) filter (where job.state = 'retry') as retry,
	count(*) filter (where job.state = 'dead') as dead,
	count(*) filter (
		where job.state = 'processing' and job.lease_expires_at <= now()
	) as expired_leases,
	min(job.available_at) filter (
		where job.state in ('queued', 'retry') and job.available_at <= now()
	) as oldest_available_at,
	coalesce(
		now() - min(job.available_at) filter (
			where job.state in ('queued', 'retry') and job.available_at <= now()
		),
		interval '0 seconds'
	) as max_available_delay
from public.media_enrichment_jobs as job
inner join public.thread_media_metadata as metadata using (thread_id)
group by job.provider
order by job.provider;
```

최근 자동 호출 결과는 원시 응답 없이 다음처럼 확인합니다.

```sql
select
	now() as measured_at,
	provider,
	state,
	http_status,
	response_reason,
	provider_outcome,
	sum(api_request_count) as api_request_count,
	sum(rate_limited_count) as rate_limited_count,
	jsonb_agg(provider_error_counts) filter (
		where provider_error_counts is not null
	) as error_count_snapshots,
	jsonb_agg(provider_http_status_counts) filter (
		where provider_http_status_counts is not null
	) as http_status_count_snapshots,
	max(next_available_at) as latest_next_available_at,
	max(provider_cooldown_until) as latest_cooldown_until,
	count(*) as dispatch_count,
	max(created_at) as latest_dispatch_at
from public.media_worker_dispatches
where created_at >= now() - interval '24 hours'
group by provider, state, http_status, response_reason, provider_outcome
order by provider, latest_dispatch_at desc;
```

현재 provider cooldown과 최소 remaining은 다음 쿼리로 확인합니다.

```sql
select
	now() as measured_at,
	scheduler_enabled,
	youtube_enabled,
	imgur_enabled,
	imgur_batch_size,
	imgur_cooldown_until,
	imgur_cooldown_reason,
	imgur_last_rate_limit_at
from public.media_worker_runtime_settings
where id = true;
```

## 중지와 복구

예약 실행 주체는 Supabase 하나입니다. 장애가 발생하면 `crawl_runtime_settings.scheduler_enabled`를
`false`로 바꿔 신규 예약을 즉시 중지합니다. 실행 중인 작업은 source lock과 heartbeat 계약에 따라
종료되며, 설정 화면의 수동 수집은 계속 사용할 수 있습니다. Vault와 Next 환경 변수의 secret을
교정하고 `/api/crawl/scheduled` 스모크 테스트와 dispatcher 정산을 확인한 뒤 scheduler를 다시
활성화합니다.

미디어 자동 호출 전체에 문제가 있으면
`media_worker_runtime_settings.scheduler_enabled=false`만 적용합니다. 특정 공급자만 일시 중지할
때는 전역 scheduler를 유지한 채 `youtube_enabled` 또는 `imgur_enabled`만 `false`로 변경합니다.
`crawl_runtime_settings`와 기존 crawl Cron은 그대로 유지합니다. 비활성 공급자의 queued·retry
job과 metadata는 삭제하지 않으며, 이미 processing인 job은 완료되거나 lease 만료 후 복구됩니다.

예를 들어 Imgur quota를 보호하면서 YouTube만 자동 처리하려면 service-role 운영 경로에서 다음
설정을 적용합니다.

```sql
update public.media_worker_runtime_settings
set
	scheduler_enabled = true,
	youtube_enabled = true,
	imgur_enabled = false,
	updated_at = now()
where id = true;
```

현재 공급자별 스위치는 secret 없이 읽기 전용으로 확인할 수 있습니다.

```sql
select
	now() as measured_at,
	scheduler_enabled,
	youtube_enabled,
	imgur_enabled,
	youtube_batch_size,
	imgur_batch_size,
	imgur_cooldown_until,
	imgur_cooldown_reason,
	imgur_last_rate_limit_at,
	updated_at
from public.media_worker_runtime_settings
where id = true;
```

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

### 미디어 worker 승인 후 절차

Imgur 복구 배포 후 수동 검증 전에는 전역 scheduler와 YouTube는 기존 상태를 유지하고
`media_worker_runtime_settings.imgur_enabled=false`, `imgur_batch_size=1`을 유지합니다.

1. 애플리케이션에 `YOUTUBE_API_KEY`, `IMGUR_CLIENT_ID`, `CRAWL_INTERNAL_SECRET`이 서버 전용으로
   등록됐는지 존재 여부만 확인합니다.
2. 위 읽기 전용 대조 쿼리의 측정 시각, provider별 thread·metadata·job 수와 상태별 수를 기록합니다.
3. 신규 non-Trash Imgur URL 한 건을 수집한 뒤 배포된 앱 또는 승인된 비운영 환경에서 Imgur
   endpoint에 `limit=1`로 한 번 수동 요청합니다.
   Authorization 값, API credential, 응답 원문은 로그나 작업 기록에 남기지 않습니다.
4. 응답의 `diagnostics.apiRequestCount`가 image/direct-file 1회, 별도 images 조회가 필요한 album
   최대 2회와 일치하는지 확인합니다.
5. `queued → processing → succeeded|retry`, metadata 상태, lease 해제, 일반 카드 또는 Imgur 카드
   표시와 YouTube scheduler 지속 동작을 확인합니다.
6. `media_worker_dispatches`의 transport `state`, `provider_outcome`, 오류·HTTP 상태 집계, cooldown과
   예상 밖의 `lease_rejected_count`가 없는지 확인합니다.
7. 수동 검증 성공 후 service-role 운영 경로에서 `imgur_enabled=true`, `imgur_batch_size=1`만
   변경합니다. global scheduler와 YouTube switch는 변경하지 않습니다.
8. 첫 24시간 동안 ready 비율, 실제 API 요청 수, 429·5xx·transport 오류, cooldown,
   oldest pending을 관찰합니다. 24시간 안에 rate-limit이 3회 이상 발생하면 Imgur만 다시
   비활성화하고 Client ID 등록과 사용량을 점검합니다.

### 미디어 자동화 롤백

1. 공급자 하나의 장애면 해당 `*_enabled`만 비활성화하고, 공통 경로 장애면 media scheduler
   스위치만 비활성화합니다. 기존 crawl scheduler는 끄지 않습니다.
2. Imgur 장애에서는 먼저 `imgur_enabled=false`로 호출을 차단하고 이전 애플리케이션을
   재배포합니다. 새 nullable dispatch 컬럼과 cooldown RPC는 이전 코드와 호환되므로 destructive
   down migration을 수행하지 않습니다.
3. 배포·secret·provider 장애를 교정하고 사용자가 수동 `limit=1` 검증을 다시 통과시킵니다.
4. queued·retry·processing job, metadata와 thread는 삭제하거나 `normal`로 되돌리지 않습니다.
5. Cron 자체를 제거해야 할 때만 `cron.job`을 직접 수정하지 않고 media 전용 job ID를
   `cron.unschedule(jobid)`에 전달합니다. crawl·alert·cleanup Cron은 제거하지 않습니다.
6. 재등록은 migration의 `cron.schedule` 계약을 다시 적용한 뒤 비활성 상태에서 검증합니다.

현재 구현 계약의 공식 근거는 [Supabase Cron](https://supabase.com/docs/guides/cron),
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[Vault](https://supabase.com/docs/guides/database/vault),
[Data API 보안](https://supabase.com/docs/guides/api/securing-your-api) 문서입니다. 2026년
`public` 객체 자동 노출 변경에 대비해 새 테이블의 RLS와 role grant를 migration에서 명시합니다.
Cron 변경은 `cron.job` 직접 수정 대신 `cron.schedule`·`cron.unschedule`만 사용합니다.

## DB 작업 큐 도입 기준

현재 세 소스는 serverless 실행 예산 안이므로 별도 작업 큐를 두지 않습니다. 다음 조건 중 하나가
필요해지면 `available_at`, lease owner, attempt 수, 우선순위를 가진 DB queue와 다중 worker로
전환합니다.

- 단일 소스 작업이 45초 예산을 반복해서 초과함
- 배포나 프로세스 종료 후에도 개별 지연 재시도를 보존해야 함
- 소스 수 증가로 우선순위·공정성·backpressure가 필요함
- 여러 worker가 durable job을 경쟁적으로 가져가야 함
