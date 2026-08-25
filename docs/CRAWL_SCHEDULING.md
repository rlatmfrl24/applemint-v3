# 크롤러·YouTube worker 예약 실행 운영 가이드

## 기본 정책

- 활성 크롤링 소스의 초기 최소 실행 간격은 `arcalive` 2시간, `battlepage` 4시간,
  `insagirl` 3시간, `issuelink` 3시간입니다.
- IssueLink는 12시간 인기순 한 페이지를 3시간마다 확인합니다. 순위를 보존하되 회당 전체
  20건, 원 커뮤니티별 3건까지만 후보로 전달하고 영구 수집 이력으로 중복을 제거합니다.
  제한으로 제외한 정상 후보는 parser 오류가 아닌 ignored 항목으로 관측합니다.
- 소스 실행 예산은 45초이며, 서로 다른 소스는 최대 2개까지 동시에 실행합니다.
- 동일 소스 중복 실행은 `crawl:<source>` 잠금으로 차단합니다.
- 수동 실행은 예약 cooldown과 `schedule_enabled`만 우회합니다.
- 잠금 TTL은 60초이고 실행 중에는 15초마다 heartbeat로 갱신합니다.

소유자는 `/main/setting/crawling`에서 소스별 예약 활성 여부와 30분~7일 범위의 주기를 수정할 수
있습니다. 화면의 “다음 예상 실행”은 cooldown 종료를 다음 5분 Cron 경계로 올림한 시각입니다.

## Supabase 크롤러 예약 자동화

`crawl_runtime_settings.scheduler_enabled`가 크롤러 예약의 최종 스위치입니다. 기본값은
`false`이며 배포 검증과 Vault 구성이 끝난 뒤에만 활성화합니다.

- `applemint-dispatch-due-crawl-sources`: 5분마다 실행 가능한 소스를 `pg_net`으로
  `/api/crawl/scheduled`에 전달합니다.
- `applemint-reconcile-crawl-dispatches`: 1분마다 HTTP 결과를 정산하고 2분 이상 응답이 없는
  요청을 `expired`로 처리합니다.
- `applemint-clean-crawl-dispatches`: 매일 30일이 지난 dispatch 감사 이력을 제거합니다.

Vault에는 migration에 값을 넣지 않고 다음 이름으로 등록합니다.

- `crawl_app_base_url`: 운영 Next 애플리케이션 origin
- `crawl_internal_secret`: Next의 `CRAWL_INTERNAL_SECRET`과 같은 32바이트 이상 값

Vault 값이 없거나 올바르지 않으면 dispatcher는 `configuration-missing`으로 종료하고 외부 요청을
보내지 않습니다. 예약 API가 인증·설정 오류를 반환하면 크롤러 scheduler를 자동 중지하며 수동
수집은 계속 사용할 수 있습니다.

## YouTube 메타데이터 worker 자동화

YouTube 메타데이터 worker는 크롤러와 별도 scheduler를 사용합니다.

- `applemint-dispatch-media-workers`: 1분마다 실행 가능한 YouTube queue를 확인합니다.
- `applemint-reconcile-media-worker-dispatches`: 1분마다 `pg_net` 응답을 정산합니다.
- `applemint-clean-media-worker-dispatches`: 매일 03:50 KST에 30일이 지난 dispatch 감사를
  제거합니다.
- 내부 endpoint는 `/api/media/youtube/enrich` 하나이며 한 번에 최대 50개를 처리합니다.

`ingest_crawl_items`는 YouTube thread에만 pending metadata와 queued job을 원자적으로 생성합니다.
재수집된 URL은 `crawl-history` 충돌로 새 thread, metadata, job을 만들지 않습니다.

YouTube thread가 Trash로 이동하면 아직 처리되지 않은 metadata와
`queued | retry | processing` job을 같은 트랜잭션에서 삭제합니다. 이미
`succeeded | dead`인 종단 job과 완료 metadata는 보존합니다. Trash에서 복원해도 취소된 job을
다시 만들지 않습니다.

Vault 값이 없거나 base URL·secret 형식이 올바르지 않으면 media scheduler만 비활성화합니다.
기존 `crawl_runtime_settings.scheduler_enabled`는 변경하지 않습니다.

| 응답 | `media_worker_dispatches.state` | 동작 |
| --- | --- | --- |
| 2xx | `succeeded` | transport 성공과 정규화된 worker 건수 기록 |
| 401 | `authentication-error` | YouTube switch만 자동 중지 |
| 403 | `authorization-error` | YouTube switch만 자동 중지 |
| 404 | `endpoint-not-found` | YouTube switch만 자동 중지 |
| 429 | `rate-limited` | queue와 lease를 보존하고 다음 실행에서 복구 |
| 5xx | `server-error` | queue와 lease를 보존하고 다음 실행에서 복구 |
| timeout·network | `transport-error` | 응답 정산 후 다시 dispatch 가능 |
| 2분간 응답 없음 | `expired` | 응답 감사를 만료하고 다시 dispatch 가능 |

YouTube worker가 job을 claim한 뒤 중단되면 45초 lease가 만료된 후 다시 claim할 수 있습니다.
429·5xx·timeout은 job을 `retry`로 돌리고 `available_at`까지 재claim하지 않습니다.
`quotaExceeded`, `dailyLimitExceeded` 계열은 25시간 뒤에 재시도하고 최대 7회까지 보존합니다.
일반 오류는 지수 backoff와 최대 5회 정책을 적용합니다.

## 읽기 전용 운영 조회

### YouTube enrichment 범위

다음 쿼리는 측정 시각과 YouTube enrichment 상태를 확인합니다.

```sql
select
	now() as measured_at,
	count(*) filter (where thread.type = 'youtube') as youtube_threads,
	count(metadata.thread_id) filter (
		where thread.type = 'youtube'
	) as youtube_metadata,
	count(job.thread_id) filter (
		where thread.type = 'youtube'
	) as youtube_jobs,
	count(*) filter (
		where thread.type = 'youtube' and metadata.thread_id is null
	) as youtube_missing_metadata
from public.threads as thread
left join public.thread_media_metadata as metadata
	on metadata.thread_id = thread.id
left join public.media_enrichment_jobs as job
	on job.thread_id = thread.id
where thread.type = 'youtube';
```

### queue 지연과 lease

```sql
select
	now() as measured_at,
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
inner join public.thread_media_metadata as metadata using (thread_id);
```

### 최근 dispatch와 scheduler 상태

```sql
select
	now() as measured_at,
	state,
	http_status,
	response_reason,
	sum(claimed_count) as claimed_count,
	sum(ready_count) as ready_count,
	sum(retried_count) as retried_count,
	sum(failed_count) as failed_count,
	count(*) as dispatch_count,
	max(created_at) as latest_dispatch_at
from public.media_worker_dispatches
where created_at >= now() - interval '24 hours'
group by state, http_status, response_reason
order by latest_dispatch_at desc;
```

```sql
select
	now() as measured_at,
	scheduler_enabled,
	youtube_enabled,
	youtube_batch_size,
	updated_at
from public.media_worker_runtime_settings
where id = true;
```

## 중지와 복구

크롤러 예약에 문제가 있으면 `crawl_runtime_settings.scheduler_enabled=false`로 신규 예약을
중지합니다. media worker 문제로 크롤러 scheduler를 끄지 않습니다.

YouTube metadata 처리만 중지하려면 service-role 운영 경로에서 다음처럼 변경합니다.

```sql
update public.media_worker_runtime_settings
set
	youtube_enabled = false,
	updated_at = now()
where id = true;
```

공통 media dispatch 경로에 문제가 있으면 `scheduler_enabled=false`를 사용합니다. 원인을 교정한
뒤 `YOUTUBE_API_KEY`, `CRAWL_INTERNAL_SECRET`, Vault 두 값을 확인하고 비운영 또는 사용자가 승인한
환경에서 YouTube worker 한 건을 검증한 후 다시 활성화합니다.

Cron을 제거해야 할 때는 `cron.job`을 직접 수정하지 않고 대상 job ID를
`cron.unschedule(jobid)`에 전달합니다. 기존 crawl·alert·cleanup Cron을 함께 제거하지 않습니다.

현재 계약의 공식 근거는 [Supabase Cron](https://supabase.com/docs/guides/cron),
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[Vault](https://supabase.com/docs/guides/database/vault),
[Data API 보안](https://supabase.com/docs/guides/api/securing-your-api)입니다. `public` 객체는
RLS와 role grant를 migration에서 명시합니다.

## DB 작업 큐 도입 기준

외부 호출이 길어지거나 실패 재시도가 중요하고, 여러 worker가 같은 작업을 경쟁할 수 있는 경우에만
lease, `available_at`, attempt count를 가진 durable queue를 사용합니다.
