# 북마크 정기 분할 재분류 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 북마크를 하루 한 회차씩 재분류하고 소속이 달라지는 건에 사용자가 검토할 이동 제안을 만든다.

**Architecture:** 기존 Supabase 분 단위 디스패처에서 KST 날짜별로 제한된 수의 `classify` 항목을 기존 큐에 등록한다. 기존 분류기, AI 예산 장부, 워커 게시 검사와 소유자 승인 경로를 공유하며, 설정과 시작·종료 제약은 DB에서 보장한다.

**Tech Stack:** Node.js `24.x`, pnpm `10.33.0`, Next.js, React, tRPC, Zod, Supabase Postgres, pgTAP, Vitest, Playwright.

**Spec:** [북마크 정기 분할 재분류 설계](../specs/2026-11-19-bookmark-scheduled-reclassification-design.md).

## Global Constraints

- 기본값은 꺼짐이고 기본 수량은 **회차당 100건**이다. 수량은 **1–500건** 사이에서 설정한다. 실행 기준은 매일 **09:00 KST 이후**다.
- 기존 `applemint-bookmark-worker` cron과 `dispatch_bookmark_worker()`를 재사용한다. 정기 분류는 `kind='classify'`, `scope='selected'`, `origin='scheduled-classify'`로 기존 작업 테이블에 등록한다.
- 저장 추천과 수동 분류가 사용하는 현행 정책을 공유한다. 실제 이동은 기존 소유자 승인 경로에서 실행한다.
- 기존 달력 월 **$1 공유 AI 예산**을 KST 기준으로 사용한다. 모델 요청당 기존 최대 20건과 입력 한도를 사용한다.
- 비용 예약 성공 시점을 이미 시작된 요청의 기준으로 삼는다. 청구 불명확 요청은 자동으로 재호출하지 않는다.
- 구현 전 `AGENTS.md`가 지정한 로컬 Next.js 가이드를 확인한다. 새 제품 의존성이나 별도 스케줄러가 필요 없다. 구현 검증과 운영 활성화는 별도 결정이다.

## Review Focus

1. **동시 등록과 빈 날짜** — 한 날짜에 중복 작업이 생기거나 후보가 없는 분마다 보관함을 다시 조회하는지를 1단계에서 검증한다.
2. **비활성화와 비용 예약 경합** — 예약 전후를 나눠 이미 승인한 청구의 정산과 신규 발송 차단을 2단계에서 검증한다.
3. **결과가 도착하기 전 소속 변경** — 선행 수동 제안, 북마크 버전 변경, 휴지통, 목적지 변경에 대한 게시 규칙을 2단계에서 검증한다.
4. **실패한 회차 재개·종료 경합** — 활성 lease, 이전 종료 이력, 예약 상태와 다음 날짜 등록을 2·3단계에서 검증한다.
5. **화면으로 끝까지 도달** — 소유자 설정부터 실제 워커·모델·검토·승인·DB 재조회까지 4단계에서 검증한다.

---

## 1. DB에서 회차 날짜와 등록 수량을 제한한다

**Files** · `supabase/migrations/<CLI 생성 시각>_bookmark_scheduled_classification_queue.sql`, `supabase/tests/bookmark-scheduled-classification.test.sql`, `supabase/tests/bookmark-scheduled-classification-concurrency.test.sql`.

**Interfaces** · `private.enqueue_bookmark_scheduled_classification(p_now timestamptz) → uuid | null`. 소유자 RPC `public.bookmark_scheduled_classification_settings() → jsonb`, `public.bookmark_scheduled_classification_update_settings(p_enabled boolean,p_daily_limit integer) → jsonb`. 설정 응답은 `{enabled,dailyLimit,timeZone,hour,startedAt,nextEligibleAt,status,lastJob}`다. `startedAt`과 `nextEligibleAt`은 ISO 시각 또는 null, `status`는 `disabled | waiting | running | blocked | complete`, `lastJob`은 기존 작업 행 또는 null이다.

- [ ] **회차 등록 회귀 테스트를 작성한다.** 08:59 KST와 기본 꺼짐에서 작업이 0건이다. 09:00에 회차 한도 2로 등록하면 선택한 2건과 기준 버전이 한 트랜잭션으로 저장된다. 최초 설정 뒤 생성한 북마크, 휴지통, 같은 버전의 검토 대기, 활성 수동 분류 항목을 제외한다. 완료·제외·실패한 회차 항목의 자동 재등록은 0건이고, 오래된 수동 전체 작업의 중단은 첫 회차를 막지 않는다.
- [ ] **동시성·권한 회귀 테스트를 작성한다.** 기존 `bookmark-health-schedule-concurrency.test.sql`의 격리 세션 패턴을 사용한다. 두 세션이 동일 KST 날짜 09:01에 호출하면 같은 날 작업 하나, 항목 합계 2건이다. 활성 회차와 소유자 종료 날짜에는 새 작업 0건이다. 보류 상태로 후보가 없으면 빈 작업 없이 날짜를 저장하고, 같은 날짜에 후보가 추가돼도 재조회하지 않는다. 비소유자의 설정 변경과 일반 역할의 스케줄러 직접 호출을 거부한다.
- [ ] **실패를 확인한다.** `pnpm test:db`에서 새 계약 테스트가 등록 함수 또는 동작의 부재로 실패해야 한다.
- [ ] **제한된 등록을 구현한다.** `supabase migration new bookmark_scheduled_classification_queue`로 마이그레이션을 만든다. `bookmark_settings`에 활성 여부·한도·최초 활성 시각·마지막 KST 조회 날짜·마지막 조회 결과를 기록한다. 조회 결과는 `queued | deferred | exhausted`로 구분한다. 첫 활성화에서만 기준 시각을 저장하고 이후 껐다 켜기는 그 시각을 보존한다.
- [ ] **등록 트랜잭션과 조회 규칙을 구현한다.** `bookmark:scheduled-classification` 트랜잭션 advisory lock을 설정·등록·예약·재개·종료에서 공통으로 사용한다. 등록에서 이전 미완료 회차, `progress.closedAt`이 속한 KST 날짜, 당일 조회 날짜를 먼저 확인한다. 오늘 종료한 회차가 있으면 오늘 등록을 건너뛴다. 기존 `bookmark_job_items`와 작업 origin으로 이미 등록한 ID를 제외하고 `bookmarks.created_at <= startedAt`인 보관함을 `saved_at, id` 순서로 제한한다. 버전 일치 `pending classify` 제안과 미완료 활성 분류 항목은 보류한다. 후보 전부가 보류 중이면 `deferred`, 등록할 기존 ID 자체가 없으면 `exhausted`를 기록한다. 기존 인덱스로 조회 계획을 확인하고 필요할 때만 북마크 ID 기준 작업 항목 인덱스를 추가한다. 회차 키는 `scope.scheduledDate`이며, `classify`의 해당 origin만 적용하는 날짜 고유 인덱스로 중복 등록을 차단한다.
- [ ] **진입점과 검증을 마친다.** 설정 RPC는 `is_applemint_owner()`를 검증한 authenticated 호출만 허용하고, 클라이언트의 일반 `bookmark_command('start', ...)`에서 예약 origin을 사칭하는 입력을 거부한다. 설정 조회는 저장된 조회 결과와 최근 회차로 상태를 구성한다. `nextEligibleAt`은 다음 등록이 가능한 KST 09:00 시각 또는 이미 열린 당일 창의 09:00이며 비활성·차단·완료에는 null이다. `pnpm test:db`에서 새 테스트와 기존 자동 점검·수동 등록 테스트가 모두 통과하면 이 단계 파일만 커밋한다.

## 2. 기존 워커에서 게시와 비용 안전장치를 적용한다

**Files** · `supabase/migrations/<CLI 생성 시각>_bookmark_scheduled_classification_worker.sql`, `supabase/tests/bookmark-scheduled-classification-worker.test.sql`, `server/bookmarks/worker.ts`, `server/bookmarks/worker.test.ts`, `types/database.types.ts`.

**Interfaces** · `public.bookmark_scheduled_classification_reserve(p_id uuid,p_job uuid,p_lease uuid,p_tokens int,p_amount bigint,p_provider text,p_model text) → reserved | disabled | denied`. service role만 호출한다. 기존 `bookmark_ai_reserve`, `bookmark_worker_claim`, `bookmark_worker_commit`의 공개 계약과 수동 호출 방식은 유지한다.

- [ ] **예약·실행 회귀 테스트를 작성한다.** 예약 전에 사용자가 끄면 `disabled`, AI HTTP 호출 0회다. 예약 성공 뒤 끄면 해당 요청을 정산하고 다음 예약은 거부한다. 기존 수동 분류, 추천, 자동 링크 점검은 정기 분류 설정의 영향을 받지 않는다. 달력 월 예산 거부 후 새 예약은 없고, 불명확 응답의 예약은 보존되며 작업이 `paused`에 머문다. 저장 추천과 수동 작업이 정기 분류보다 먼저 claim된다.
- [ ] **게시 회귀 테스트를 작성한다.** 주제·출처·커뮤니티 기타·최상위 기타 선택은 기존 출력과 일치한다. 활성 목적지 없음, 미분류 또는 현재와 동일한 목적지는 제안 0건이다. 모델 요청 전 이미 달라진 버전·휴지통은 요청에서 제외한다. 요청 중 편집, 휴지통 이동 또는 목적지 무효화가 발생하면 오래된 제안 없이 실패 사유를 표시하고 영수증은 보존한다. 수동 제안이 먼저 같은 버전에 게시되면 정기 중복 제안 0건이다. 정기 분류 전후 `bookmarks` 소속·버전과 이동 이력은 일치한다.
- [ ] **실패를 확인한다.** `pnpm test:db`와 `pnpm exec vitest run server/bookmarks/worker.test.ts server/bookmarks/classification-policy.test.ts`를 실행한다. 새 예약과 정기 결과 기준이 적용되기 전 두 환경에서 의도한 회귀가 실패해야 한다.
- [ ] **등록된 회차만 비용 예약하도록 연결한다.** `supabase migration new bookmark_scheduled_classification_worker`로 마이그레이션을 만든다. 기존 claim 조건에서 origin을 분기해 정기 설정 꺼짐·종료 회차를 건너뛴다. 예약 RPC는 1단계 lock을 job row 및 기존 월 예산 lock보다 먼저 취득하고, origin·lease·설정 상태를 검증한 뒤 기존 예약 함수를 사용한다. 작업이 claim된 직후 꺼진 경우 남은 항목을 기존 `retry` 상태로 유지하며, UI 대기 여부는 설정에서 읽는다. `denied`는 기존 예산 중단 경로를 사용한다. `bookmark_ai_reserve` 자체의 금액 계산을 복제하지 않는다.
- [ ] **같은 분류기를 연결하고 게시를 방어한다.** `aiBatch`의 정기 origin 분기에서 claim의 `expected_version`과 현재 `version/state`를 비교한 뒤 기존 모델 요청과 `resolveBookmarkTopicTarget`을 사용한다. 기존 결과에 비교 사유를 남기고 소속 변경이 필요한 경우만 제안을 전달한다. DB 게시 구간에서 `private.bookmark_worker_commit_legacy`의 분류 대상 북마크 행을 proposal insert 전에 잠근다. 정기 origin에 한해 현재 버전·상태·소속 및 기존 동버전 대기 제안을 다시 확인하고, 기존 출처·`etc` 게시 잠금과 영수증 처리 순서를 보존한다. 수동 게시에도 같은 북마크 행 잠금을 사용해 정기 게시 시점의 중복 확인을 직렬화한다.
- [ ] **생성 타입과 검증을 마친다.** `pnpm db:types:generate`로 RPC 타입을 반영한다. 1·2단계 DB 및 대상 Vitest를 다시 실행해 통과하면 이 단계 파일만 커밋한다.

## 3. 소유자 설정과 회차 종료를 연결한다

**Files** · `supabase/migrations/<CLI 생성 시각>_bookmark_scheduled_classification_controls.sql`, `supabase/tests/bookmark-scheduled-classification-controls.test.sql`, `contracts/bookmark-scheduled-classification.schema.ts`, `server/repositories/bookmark.repository.ts`, `server/services/bookmark.service.ts`, `server/trpc/routers/bookmark.router.ts`와 해당 테스트, `app/main/setting/bookmarks/bookmark-scheduled-classification-settings.tsx`, `app/main/setting/bookmarks/page.tsx`, `app/main/bookmarks/bookmark-jobs.tsx`와 해당 테스트, `types/database.types.ts`.

**Interfaces** · `public.bookmark_scheduled_classification_close(p_id uuid,p_confirmed boolean) → jsonb`는 기존 `bookmarkJobSchema` 형식의 행을 반환한다. `bookmarkAI.scheduledSettings`, `bookmarkAI.updateScheduledSettings`, `bookmarkAI.closeScheduledJob({id,confirmed:true})`를 제공한다. 재개는 기존 `bookmarkImport.resume({id})`를 사용한다.

- [ ] **수명주기와 권한 회귀 테스트를 작성한다.** 소유자만 확인 후 lease 없는 `paused/failed/partial` 정기 회차를 종료한다. 완료한 1건과 남은 1건이 있을 때 부분 완료와 종료 시각이 남고, 결과·제안·불확실 예약은 보존된다. 같은 ID 재개·다시 자동 등록·종료 당일 신규 회차가 모두 거부된다. 다음 날에는 다른 후보가 등록된다. 두 세션이 종료와 재개를 동시에 실행하면 하나만 성공한다. 수동 및 예전 전체 작업은 이 종료 RPC의 대상에서 제외한다.
- [ ] **설정 및 작업 기록의 UI 테스트를 작성한다.** 기본 꺼짐·100건과 범위 1–500건, 시작 시각·현재 상태·다음 시각, 저장 실패 후 입력 보존을 확인한다. 최근 정기 작업 링크와 대기·실패·종료 상태를 표시한다. 종료 버튼을 먼저 눌러도 확인 전 RPC 호출은 0회다. 종료된 작업의 재개 버튼은 표시되지 않는다. 기존 승인·제외·수동 분류 버튼 동작은 보존한다.
- [ ] **실패를 확인한다.** `pnpm test:db`와 `pnpm exec vitest run server/trpc/routers/bookmark.router.test.ts server/services/bookmark.service.test.ts server/repositories/bookmark.repository.test.ts app/main/setting/bookmarks/bookmark-scheduled-classification-settings.test.tsx app/main/bookmarks/bookmark-jobs.test.tsx`에서 새 API와 UI 부재에 해당하는 실패를 확인한다.
- [ ] **서버에서 정기 회차 종료와 재개를 직렬화한다.** `supabase migration new bookmark_scheduled_classification_controls`로 마이그레이션을 만든다. 확정 입력, 소유자, 정기 origin, 기존 상태와 lease를 검증한다. 1단계 lock → 대상 작업 행 순으로 잠근다. 남은 `pending/waiting` 항목에 종료 사유를 기록하고 `failed`로 마감한다. 기존 `done/failed` 항목, 제안, 예약은 보존한다. 완료 항목이 있으면 작업 상태는 `partial`, 없으면 `failed`로 두고 `progress.closedAt`에 종료 시각을 기록한다. 기존 재개 명령에도 같은 lock을 두어 닫힌 정기 작업과 다른 미완료 정기 회차가 있는 재개를 거부한다.
- [ ] **설정과 검토 진입점을 연결한다.** 1단계 응답을 Zod로 검증하고 기존 ownerProcedure → 서비스 → repository → RPC 패턴으로 연결한다. 설정 화면에는 시간·수량·월 공유 예산·현재 상태와 작업 기록 링크를 표시한다. 작업 기록에는 **정기 재분류**, **회차 종료**, **종료됨**을 표시한다. 청구 불명확일 때 재개 전에 예약 보존과 재호출 가능성을 설명한다. 승인·제외는 기존 **컬렉션 제안** 화면을 연결한다.
- [ ] **실제 스케줄 진입점을 연결한다.** `dispatch_bookmark_worker()`에 `private.enqueue_bookmark_scheduled_classification(now())`를 연결한다. 기존 자동 링크 점검 등록과 기존 worker dispatch를 유지한다. 호출 전에 Vault 및 dispatch 준비 상태를 확인한다. 세 단계 마이그레이션과 애플리케이션을 하나의 릴리스로 검증한다. `pnpm db:types:generate`와 3단계 DB·Vitest가 통과하면 이 단계 파일만 커밋한다.

## 4. 정상 진입점에서 정기 처리부터 승인까지 확인한다

**Files** · `e2e/bookmark-ai.spec.ts`, `docs/reports/2026-11-19-bookmark-scheduled-reclassification-verification.md` 또는 작업 PR의 검증 원장.

- [ ] **격리 환경의 실제 흐름 검증을 추가한다.** 기존 `bookmarkOwner()`와 `BOOKMARK_LIVE_AI=1` 패턴을 사용한다. 루프백 검증 DB와 앱 주소, 전용 테스트 데이터, 09:00 KST 이후 실행 창을 확인한다. 다른 북마크가 섞이지 않는 DB에서 주제·등록 출처·커뮤니티 기타·최상위 기타·동일 소속 사례를 준비한다. 설정 화면에서 5건을 활성화하고 기존 cron → worker → 실제 모델 → 검토 화면을 밟는다. DB에서 최초 회차 총 5개와 일치하는 응답·예약을 읽는다. 같은 소속의 제안은 0건, 나머지 목적지는 예상 ID, 승인 전 북마크의 소속은 시작 시점과 같다.
- [ ] **사용자 승인과 종료 결과를 확인한다.** 한 건만 검토 화면에서 승인하고 새로고침 및 소유자 DB로 이동한 ID를 확인한다. 다른 제안을 제외하고 정기 등록 이력으로 다시 선택되지 않는지 별도 날짜 검증에서 대조한다. 종료와 다음 날짜 동작은 격리 pgTAP의 시각 인자 테스트에서 확인한다. 실제 브라우저 확인은 스케줄러가 연결된 통합 흐름에서 진행한다.
- [ ] **검증 명령을 실행한다.** `pnpm verify`로 lint·생성 타입·Vitest·pgTAP·프로덕션 빌드를 통과시킨다. 격리 DB와 앱이 정상 연결된 상태에서 PowerShell의 `$env:BOOKMARK_LIVE_AI='1'`로 `pnpm exec playwright test --config playwright.bookmarks.config.ts e2e/bookmark-ai.spec.ts --grep "정기 재분류"`를 실행한다. opt-in 테스트가 실제로 실행됐으며 1건 이상 통과해야 한다.
- [ ] **증거와 변경 범위를 검토한다.** 예정/실제 수량, 시각·origin, 정산, 제안·승인, 전후 북마크 상태를 테스트 커밋과 함께 기록한다. 전체 재분류 일괄 등록이나 운영 활성화 증거는 이번 검증 범위에 넣지 않는다. `git diff --check`를 확인하고 검증에 추가한 파일만 커밋한다.
