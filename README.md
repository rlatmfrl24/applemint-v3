# Applemint v3

개인용 트렌드 링크 수집/정리 프로젝트입니다.
여러 커뮤니티 소스를 크롤링해 `threads(state='inbox')`에 적재하고, 웹 UI에서 빠르게 확인/분류(`Quick Save`, `Trash`)할 수 있도록 구성되어 있습니다.

> 이 문서는 개인 프로젝트 운영 관점에 맞춰 작성되었으며, 설치/배포 가이드는 의도적으로 제외했습니다.

## Windows 로컬 실행

Windows 로그인 시작 항목에 등록한 `Applemint Docker 자동 실행` 대기 프로세스가 Docker와 Supabase 준비 상태를 10초마다 확인합니다.
Docker Desktop만 실행하면 기존 로컬 Supabase 컨테이너가 재시작되고, DB·인증 서비스 준비 후 개발 웹 서버가 자동 실행됩니다.
별도 실행 파일이나 터미널 명령을 입력할 필요가 없습니다. Node.js 24를 사용하며 DB 초기화·인증 계정 변경은 수행하지 않습니다.

준비가 끝나면 [북마크 관리자](http://localhost:3000/main/bookmarks)에 접속합니다.
이미 3000번 포트가 사용 중이면 기존 서버를 유지하고 중복 실행하지 않습니다.
진행·오류 로그는 `reports/docker-auto-start.log`에 기록됩니다. 도커를 끈 상태에서는 대기만 하며 도커를 강제로 다시 켜지 않습니다.
`scripts/dev/watch-docker.ps1`이 감시 프로세스를 숨김으로 실행합니다. 별도 Node 콘솔 창을 열어 둘 필요가 없습니다.
`playwright/.auth/local-dev.json`의 `databaseContainer`가 가리키는 DB·인증·REST·게이트웨이를 모두 확인하며, DB·API가 loopback에 바인딩되지 않으면 시작하지 않습니다. 다른 프로젝트나 이전 DB를 CLI 기본값으로 시작하지 않습니다.
해당 기존 컨테이너에는 Docker 재시작 정책 `unless-stopped`가 필요합니다. Supabase를 명시적으로 중지했거나 컨테이너가 비정상이면 준비를 기다리며 로그에 표시합니다.
Docker가 종료되면 자동 실행한 웹 서버의 프로세스 트리만 종료하고 감시를 계속합니다. 사용자가 별도로 실행한 서버는 종료하지 않습니다.
자동 시작을 해제하려면 Windows 시작프로그램 폴더의 `Applemint Docker 자동 실행.lnk`를 제거하고 실행 중인 대기 프로세스를 종료합니다.
자동 시작 등록은 이 PC의 사용자 환경 설정이며 Git checkout만으로 다른 PC에 등록되지는 않습니다.
바로가기의 작업 폴더와 실행 스크립트는 사용할 checkout을 가리켜야 합니다. 검증용 checkout과 인증 파일을 사용하는 동안 원본 DB는 중지·보존합니다.

Docker Desktop, Supabase CLI, pnpm, Node.js 24와 기존 `playwright/.auth/local-dev.json`이 필요합니다.
수동 실행·문제 진단 시에는 프로젝트의 `local.cmd`를 사용할 수 있습니다. 로컬 인증 파일이 없으면 기존
`pnpm dev:local:prepare` 절차를 이용하고, 실자료 DB에서는 `test:e2e` 준비·초기화 명령을 실행하지 않습니다.

2026-10-14 검증: Docker와 웹 서버를 모두 종료한 뒤 대기 프로세스가 실행을 보류하는 것을 확인했습니다.
Docker만 다시 실행해 Supabase 준비 대기 → Next.js 자동 기동 → 로그인 HTTP 200을 확인했고,
북마크 33,443개·컬렉션 72개의 전체 데이터 체크섬과 기존 실행 컨테이너가 모두 보존됐습니다.
시작 항목 등록은 확인했으나 Windows 로그아웃·재로그인은 수행하지 않았습니다.

## 주요 기술 스택

### Frontend
- `Next.js 16` (App Router)
- `React 19` + `TypeScript (strict)`
- `@tanstack/react-query 5.101.4` (목록/무한 스크롤/낙관적 상태 이동)
- `Tailwind CSS` + `shadcn/ui`(Radix 기반 컴포넌트)
- `lucide-react`, `sonner`, `vaul`, `next-themes`

### Backend / Data
- `Supabase Auth` + `@supabase/ssr` (쿠키 기반 SSR 인증)
- `Supabase Postgres` (`threads`, `crawl-history`, `filter-keyword`, media metadata·durable queue)
- `Supabase Cron` + `pg_net` 기반 예약 실행
- `SQL migration` 기반 성능 튜닝 및 원자적 RPC (`transition_thread_state`, `ingest_crawl_items`)

### Crawling / Parsing
- 표준 `fetch`와 요청별 timeout
- `cheerio` HTML 파싱
- `linkifyjs` URL 추출
- 소스별 크롤러 모듈 분리 (`arcalive`, `battlepage`, `insagirl`, `issuelink`)
- DB `crawl_source_registry`가 운영 활성 상태와 표시명을 관리하고, TypeScript `CRAWL_SOURCES`가 설치된 adapter 능력을 검증

### 품질 / 보안 유지보수
- `Biome 2.5.9` 포맷·린트·정적 검사
- GitHub PR 필수 검증 (`verify`: Biome, Knip, Vitest, pgTAP, production build)
- 주간 GitHub `CodeQL`과 일간 `Security Gate` 워크플로우
- `Dependabot` 주간 보안 업데이트
- 커스텀 보안 스크립트 (`scripts/security/*`)

## 핵심 기능

- 인증 사용자만 `/main` 접근 가능 (서버 레이아웃 + 미들웨어 세션 갱신)
- 소스별 크롤링 결과 수집 후 중복 제거 및 키워드 기반 타입 분류
- `threads` inbox 무한 스크롤 목록 + 타입별 통계/필터
- YouTube·Imgur 정확 URL 분류와 타입 필터, YouTube 전용 카드와 Imgur 공식 embed 미리보기
- `Quick Save` 이동, `Trash` 이동/복원 워크플로우
- Applemint 북마크 라이브러리: 직접 저장, Raindrop 일회 이관, 수동 링크 검사·검토·복원, 승인 후 AI 컬렉션 분류
- 설정의 기능별 화면에서 소스별 예약 주기·수동 수집, 최근 90일 실행 이력, 신규 글 일괄 정리

## 아키텍처 개요

1. UI(`/main/setting/crawling`)에서 정책을 수정하거나 수동 크롤링 호출
2. Supabase Cron이 5분마다 cooldown과 가용 동시성을 확인해 Next 예약 API를 비동기로 호출
3. DB가 소스별 cooldown, source lock, 최대 2개 동시 실행을 원자적으로 판정
4. 크롤링 결과를 `filter-keyword` 기준으로 필터링/타입 분류
5. `ingest_crawl_items` RPC가 `crawl-history`, `threads`, YouTube media metadata·queue 생성을 하나의 트랜잭션으로 확정
6. 별도 Supabase Cron이 YouTube durable queue의 내부 media worker를 `pg_net`으로 호출
7. YouTube worker가 Trash가 아닌 신규 queue만 lease로 처리하고 정규화된 요약과 retry·dead 상태를 보존
8. `finish_crawl_run`이 크롤링 결과 저장과 lock 해제를 원자적으로 완료
9. UI는 tRPC `thread.*`, `crawl.runs`, `crawlPolicy.*`로 목록·운영 이력을 조회

수동 크롤링은 cooldown을 우회하지만 동일 소스 중복과 최대 동시성 제한은 지킵니다. 예약 실행,
heartbeat, 비정상 종료 복구, 비활성 media scheduler의 승인·smoke·롤백 절차는
`docs/CRAWL_SCHEDULING.md`를 참고합니다.
브라우저 tRPC, 내부 REST, Supabase RPC와 Zod 계약의 목표 경계 및 전환 원칙은
[`docs/COMMUNICATION_ARCHITECTURE.md`](docs/COMMUNICATION_ARCHITECTURE.md)를 참고합니다.
북마크의 데이터 원본, 작업 실행, 서버 환경과 검증 기록은
[`docs/BOOKMARK_IMPLEMENTATION.md`](docs/BOOKMARK_IMPLEMENTATION.md)를 참고합니다.

## 프로젝트 구조

```text
app/
  api/
    crawl/                 # 소스별 크롤러 + 수동/예약 실행 엔드포인트
    media/                 # YouTube adapter + lease worker + 내부 엔드포인트
    trpc/                  # 브라우저 일반 조회·변경의 단일 tRPC 진입점
  auth/, login/, signout/  # 인증 흐름
  main/                    # 메인, 퀵세이브, 휴지통, 설정 화면

components/
  ui/                      # shadcn/ui 기반 공통 컴포넌트

contracts/                 # tRPC·REST·Supabase raw response의 Zod 계약
server/
  repositories/            # Supabase RPC와 raw response 검증
  services/                # transport 독립 application service
  trpc/                    # context, procedure, router와 오류 변환
trpc/                      # 브라우저 tRPC·TanStack Query provider
utils/
  supabase/                # browser/server/middleware 클라이언트 팩토리

supabase/
  migrations/              # 인덱스/RPC 등 DB 변경 이력

scripts/security/          # GitHub 보안 알림 수집/게이트 스크립트
reports/security/          # 보안 점검 결과 산출물
lib/                       # 공통 타입/유틸
```

## 데이터 테이블 관계도

```mermaid
erDiagram
    FILTER_KEYWORD {
      int id
      text value
      text method
    }

    CRAWL_HISTORY {
      int id
      text crawl_source
      text url
      text host
      timestamptz created_at
    }

    CRAWL_RUNS {
      int id
      text source
      text status
      timestamptz started_at
      timestamptz finished_at
      int inserted_count
      int failure_count
      jsonb warnings
      jsonb failures
    }

    CRAWL_SOURCE_REGISTRY {
      text source
      text label
      boolean active
      timestamptz retired_at
    }

    THREADS {
      int id
      text type
      text url
      text title
      text host
      text tag
      text state
      timestamptz created_at
      timestamptz captured_at
      timestamptz state_changed_at
    }

    THREAD_MEDIA_METADATA {
      int thread_id
      text provider
      text status
      text media_kind
      text title
      text thumbnail_url
      int duration_seconds
    }

    MEDIA_ENRICHMENT_JOBS {
      int thread_id
      text provider
      text state
      int attempt_count
      timestamptz available_at
      uuid lease_token
      timestamptz lease_expires_at
    }

    FILTER_KEYWORD ||--o{ THREADS : applies_rules
    CRAWL_HISTORY ||--o{ THREADS : dedupe_gate
    CRAWL_SOURCE_REGISTRY ||--o{ CRAWL_HISTORY : classifies
    CRAWL_SOURCE_REGISTRY ||--o{ CRAWL_RUNS : governs
    CRAWL_RUNS ||--o{ CRAWL_HISTORY : records_ingest
    THREADS ||--o| THREAD_MEDIA_METADATA : has_summary
    THREAD_MEDIA_METADATA ||--o| MEDIA_ENRICHMENT_JOBS : has_job
```

- `threads.state`는 `inbox | saved | trash`이며 `transition_thread_state`가 동일 ID의 행을 단일 `UPDATE`로 이동합니다.
- `created_at`과 `captured_at`은 이동 시 불변이고 `state_changed_at`만 상태 변경 시 갱신됩니다.
- `threads.tag`는 배열 성격의 태그 데이터를 저장합니다.
- `crawl-history`는 `(crawl_source, url)` 유니크 인덱스로 중복 유입을 영구적으로 방지합니다. 사용자 목록에서 삭제된 URL도 재수집하지 않으며, 기간 만료 삭제·아카이브·월별 파티셔닝을 적용하지 않습니다.
- `crawl_source_registry`는 active·retired lifecycle과 운영 표시명의 권위입니다. 실행·정책·장애·Push 경로는 active 행만 처리하고, 과거 retired source 감사 이력은 FK로 보존합니다.
- `crawl_runs`는 재시도를 포함한 한 번의 실행을 한 행으로 보존하며 90일이 지난 이력은 매일 03:15 KST에 정리합니다.
- `crawl_alert_incidents`는 소스 장애의 발생·복구 상태를 보존하고 설정 화면에 표시합니다.
- `thread_media_metadata`는 외부 원시 응답 없이 YouTube 표시용 요약만 저장합니다.
- `media_enrichment_jobs`는 YouTube lease·retry·dead 상태를 보존하며 사용자 클라이언트에 직접 노출하지 않습니다.
- Imgur URL은 `threads.type='imgur'`로 분류하며 YouTube 카드와 같은 썸네일 크기로 공식 embed를 기본 표시합니다.
- 스레드가 Trash로 이동하면 아직 처리 중인 metadata와 `queued | retry | processing` job을 원자적으로 삭제합니다. 이미 완료된 metadata는 보존하며 복원해도 취소된 job을 다시 만들지 않습니다.
- YouTube media worker Cron은 기존 crawl scheduler와 별도이며 전역·YouTube switch를 각각 유지합니다.
- `crawl-history` 용량 측정, 백업·복구, 성능 검증 절차는 [`docs/CRAWL_HISTORY_RETENTION.md`](docs/CRAWL_HISTORY_RETENTION.md)를 참고합니다.
- media queue 조회, 승인 후 수동 smoke·활성화와 롤백 절차는 [`docs/CRAWL_SCHEDULING.md`](docs/CRAWL_SCHEDULING.md)를 참고합니다.
- PWA 설치, VAPID 배포, Web Push 활성화·롤백과 기기 검증은 [`docs/PWA_WEB_PUSH.md`](docs/PWA_WEB_PUSH.md)를 참고합니다.
- 상태별 목록·통계 API는 `list_threads_page`, `get_thread_stats` RPC를 사용합니다.

## 유지보수 가이드

### 1) 크롤러 소스 추가/변경
- 신규 source는 `registry lifecycle 행 등록 → dormant adapter·parser 구현 → active registry와 CRAWL_SOURCES parity 검증 → 정책 생성·예약 활성화` 순서로 승격
- adapter 구현 전에는 registry 행을 retired 상태로 두고, 활성화 release에서 DB active 전환과 `CRAWL_SOURCES` 등록을 함께 검증해 불일치 시 fail closed
- `app/api/crawl/<source>-parser.ts`에 네트워크와 분리된 순수 파서 구현
- `app/api/crawl/<source>.ts`에서 요청 결과를 공통 파서 계약에 연결
- `app/api/crawl/crawl-runner.ts`의 `CRAWLERS`에 타겟 등록
- 반환 타입은 `{items, attempted, succeeded, failures, warnings, parserObservations}` 구조를 유지
- 정상 빈 목록·일부 제외는 `info`, 최소 추출 건수 미달·높은 제외율은 `warning`으로 기록하며 구조 변경은 parser failure로 구분
- `partial`은 actionable warning 또는 부분 failure가 있을 때만 사용하고 정보성 진단만 있으면 `succeeded`로 기록
- 파서 변경 시 `app/api/crawl/fixtures`의 정제 fixture와 source별 parser 테스트를 함께 갱신
- 파서 최소 건수 변경 시 observation과 설정 화면의 추세 기준도 함께 검증
- 소스 장애 대비 재시도/로그 전략 유지 (`retryOperation`, `logger.ts`)

### 2) 데이터 분류/필터 정책 관리
- 무시·타입 분류 기준은 `app/api/crawl/pipeline-helpers.ts`의 `matchFilteredUrl`에서 처리
- 무시 키워드/분류 키워드는 DB `filter-keyword` 테이블에서 제어

### 3) 조회 성능 및 통계 로직
- 상태별 목록 API는 `(state_changed_at, id)` 복합 커서 기반 무한 스크롤 사용
- 통계는 Postgres RPC `get_thread_stats`를 통해 집계
- TanStack Query 키는 `threads/list/<state>/<filter>`와 `threads/stats/<state>/<filter>` 계약을 유지
- 쿼리 변경 시 tRPC router, application service·repository, query option factory와 SQL RPC 계약을
  함께 수정

### 4) 보안 운영
- 기준 문서: `SECURITY.md`
- 로컬 보안 점검:
  - `pnpm security:collect-alerts`
  - `pnpm security:baseline`
  - `pnpm security:gate`
  - `pnpm security:overrides`
- CodeQL은 주간·수동, Security Gate는 일간·수동으로 실행하며 Dependabot 흐름과 함께 지속 점검

### 5) 코드 컨벤션
- TS strict + 경로 별칭 `@/*`
- 포맷/린트 규칙은 `biome.json` 기준
- `pnpm deadcode`로 미사용 파일·의존성·export를 검사
- Vitest 커버리지는 선택 실행하는 `pnpm test:coverage`에서 statements/lines 65%, branches 55%, functions 60% 이상을 유지
- `master`만 장기 운영하며 항상 배포 가능한 상태를 유지
- 작업 시작 전 `git fetch --prune origin` 후 최신 `origin/master`에서 `codex/<task>` 브랜치를 생성
- 하나의 작업과 PR은 하나의 브랜치에만 담고, 관련 없는 변경을 함께 커밋하지 않음
- 모든 PR은 `master`를 대상으로 하며 `verify` 통과와 리뷰 스레드 해결 후 squash merge
- 병합된 원격 작업 브랜치는 자동 삭제하고, 로컬에서는 `master`를 fast-forward한 뒤 작업 브랜치를 삭제
- 빠른 로컬 정적 검증은 `pnpm check`, 병합과 같은 전체 검증은 `supabase db start` 후 `pnpm verify`
- 브라우저 E2E는 자동 CI·smoke에 포함하지 않으며 사용자가 필요할 때 `pnpm test:e2e`로 핵심 흐름 2개를 확인
- E2E는 Docker가 실행 중인 상태에서 로컬 DB를 초기화하므로 테스트 데이터가 필요한 경우에만 실행
- 최초 실행 전 `pnpm exec playwright install chromium`으로 테스트 브라우저를 설치
- E2E 준비 과정은 `--local`과 loopback 주소를 검증하므로 원격 DB를 사용하지 않음
- 신규 데이터 모델 필드 추가 시:
  - `lib/type-defs.ts`
  - Supabase 관련 쿼리 코드
  - 통계/필터 API 및 UI 표시부
  를 함께 동기화

## 유지보수용 주요 환경 변수

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (서버 전용)
- `SUPABASE_URL` (서버 전용, 미설정 시 `NEXT_PUBLIC_SUPABASE_URL` 사용)
- `CRAWL_INTERNAL_SECRET` (Next 예약 API와 Supabase Vault가 공유하는 32바이트 이상 secret)
- `YOUTUBE_API_KEY` (YouTube metadata worker 전용 서버 환경 변수)
- `OPENROUTER_API_KEY` (서버 전용; 북마크 저장 추천·관심 주제·분류·검토 공통 AI 공급자)
- `WEB_PUSH_ENABLED` (기본 `false`, Web Push 신규 구독·발송 switch)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (서버 전용 Web Push 설정)
- `DEBUG_CRAWL`, `LOG_LEVEL`
- `GITHUB_TOKEN` 또는 `GH_TOKEN` (보안 스크립트 실행 시)
- Supabase Vault `crawl_app_base_url`, `crawl_internal_secret` (크롤러와 YouTube worker 정기 예약 호출)

Applemint는 migration에 고정한 단일 Supabase Auth 계정만 사용할 수 있습니다. 신규 가입은 비활성화하며 목록 조회는 소유자에게만 허용되고, 스레드 변경은 소유자 확인이 포함된 RPC를 통해서만 수행합니다.

AI 사용 시 실제 웹 서버 checkout의 `.env.local`에 `OPENROUTER_API_KEY`를 입력합니다. 로컬 개발 서버는 env 변경을 반영하며 설정 화면에서 ‘설정됨’을 확인할 수 있습니다. 배포 환경은 환경 변수 변경 후 다시 실행해야 합니다. 기존 OpenAI·TypeSafe 직접 연결 키는 Applemint에서 사용하지 않습니다. KST 달력 월 $1 예약·정산은 네 AI 기능이 공유하며, 비용이 불명확하면 예약액을 유지합니다. Supabase Studio의 선택 OpenAI assistant는 비활성화했습니다. 상세 운영 계약은 [북마크 구현 기록](docs/BOOKMARK_IMPLEMENTATION.md)을 확인하세요.

## 검증 명령

- `pnpm check`: Biome, Knip, TypeScript를 이용한 빠른 로컬 정적 검증
- `pnpm verify`: Biome → Knip → Vitest → pgTAP → production build 순서의 필수 검증
- `pnpm test`: Next API, 인증, UI loading, optimistic cache 단위 테스트
- `pnpm test:coverage`: 선택 실행하는 단위 테스트와 V8 커버리지 하한선 검사
- `pnpm test:db`: 15개 계약 suite로 구성된 이동·적재 rollback, 권한, lock·queue·scheduler pgTAP 테스트
- `pnpm typecheck`: TypeScript strict 검사
- `pnpm build`: Next.js production build 뒤 일반 tRPC의 service-role·`web-push` 격리와 주요 route gzip 번들 예산을 검사
- `pnpm test:e2e`: 사용자 주도로 로컬 Supabase 초기화 후 Chromium 핵심 흐름 2개 검증
- `pnpm test:e2e:ui`: 사용자 주도로 로컬 Supabase 초기화 후 Playwright UI 모드 실행
