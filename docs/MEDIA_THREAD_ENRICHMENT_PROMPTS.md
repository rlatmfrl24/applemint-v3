# YouTube·Imgur 순차 구현 권장 프롬프트

- 기준 문서: `docs/MEDIA_THREAD_ENRICHMENT_PLAN.md`
- 사용 방법: Phase 0부터 순서대로 한 번에 하나의 프롬프트만 실행한다.
- 원칙: 앞 단계의 구현과 검증 결과를 확인한 뒤 다음 단계로 진행한다.

## 공통 운영 원칙

아래 프롬프트는 각각 독립 실행할 수 있지만, 항상 다음 원칙을 따른다.

- 먼저 `docs/MEDIA_THREAD_ENRICHMENT_PLAN.md` 전체를 읽는다.
- 현재 branch, HEAD, `git status --short`와 관련 코드의 실제 계약을 다시 확인한다.
- 기존 사용자 변경을 보존하고 관련 없는 파일을 수정하지 않는다.
- 해당 Phase의 범위만 구현한다. 다음 Phase를 미리 구현하지 않는다.
- Supabase 작업에서는 설치된 `supabase` 스킬을 읽고 따른다.
- migration이 필요하면 현재 CLI의 `--help`를 먼저 확인하고
  `supabase migration new <name>`으로 파일을 만든다.
- 운영 DB에는 직접 변경을 적용하지 않는다. 로컬 migration과 테스트부터 수행한다.
- service role, API key, Client-ID, internal secret 값을 출력하거나 로그·문서·fixture에 넣지 않는다.
- 최소 변경을 우선하고 새 패키지는 꼭 필요한 경우가 아니면 추가하지 않는다.
- targeted test를 먼저 실행하고 안정된 뒤 가능한 범위에서 `pnpm verify`를 실행한다.
- local Supabase나 Docker가 없어 검증하지 못한 항목은 성공으로 간주하지 말고
  `NOT VERIFIABLE`로 명시한다.
- commit, push, PR 생성은 별도 요청이 없으면 하지 않는다.

## Phase 0 프롬프트 — 구현 준비도 점검

```text
C:\Develop\applemint-v3에서 YouTube·Imgur 스레드 확장 구현 준비도를 읽기 전용으로 점검해주세요.

반드시 먼저 다음 문서를 전체 읽으세요.
- docs/MEDIA_THREAD_ENRICHMENT_PLAN.md
- docs/MEDIA_THREAD_ENRICHMENT_PROMPTS.md
- docs/CRAWL_SCHEDULING.md
- README.md

이번 단계에서는 파일, DB, git 상태를 변경하지 마세요.

확인 범위:
1. 현재 branch, HEAD, dirty worktree와 사용자 변경
2. threads 단일 원본, 상태 이동, cursor pagination, 통계·필터 RPC
3. pipeline의 defineType, filter-keyword, crawl-history, ingest_crawl_items 계약
4. media/youtube 제거 migration과 현재 금지 제약
5. Supabase 로컬 서비스와 Docker 사용 가능 여부
6. migration 생성 명령과 전체 검증 명령의 현재 스크립트
7. YouTube·Imgur 서버 전용 환경 변수의 존재 여부만 확인하되 값은 출력 금지
8. Phase 1에서 변경할 파일, 테스트, DB 함수와 예상 충돌

운영 데이터 측정이 가능하면 읽기 전용 쿼리만 사용하고 측정 시각을 함께 기록하세요.
원격 데이터나 설정을 변경하지 마세요.

결과 형식:
- READY / BLOCKED
- 현재 기준선
- Phase 1 변경 범위
- 보존해야 할 사용자 변경
- 필수 선행 조건
- 실행 가능한 검증
- NOT VERIFIABLE 항목

아직 구현을 시작하지 마세요.
```

Phase 0 완료 조건:

- 결과가 `READY`다.
- 사용자 변경과 Phase 1 변경 파일이 충돌하지 않는다.
- 차단 항목이 있으면 해소한 뒤 Phase 0을 다시 실행한다.

## Phase 1 프롬프트 — 정확한 URL 분류·상단 필터·백필

```text
C:\Develop\applemint-v3에서 docs/MEDIA_THREAD_ENRICHMENT_PLAN.md의 Phase 1만 구현해주세요.
Phase 0 준비도 결과가 READY라는 전제이며, 현재 코드에서 다시 확인되지 않으면 구현을 중단하고
차이를 보고하세요.

목표:
- YouTube와 Imgur URL을 정확한 hostname/path 기반으로 분류
- threads.type에 youtube, imgur를 활성화
- 메인 상단 필터에 YouTube, Imgur 표시
- 기존 정확한 공급자 URL을 상태와 시각을 보존한 채 idempotent 백필

필수 계약:
1. URL parser를 별도 순수 함수로 만들고 URL 문자열 includes만으로 공급자를 판정하지 마세요.
2. YouTube 허용 hostname과 watch, youtu.be, shorts, live, embed 형태를 처리하세요.
3. Imgur의 imgur.com, www.imgur.com, i.imgur.com과 album, gallery, direct file을 처리하세요.
4. youtube.com.evil.example, query/fragment 안의 공급자 문자열은 거부하세요.
5. 공급자 판정을 기존 filter-keyword보다 먼저 적용하세요.
6. 포괄적인 media와 issuelink 타입은 계속 금지하세요.
7. ingest_crawl_items가 youtube와 imgur를 normal로 되돌리지 않게 하세요.
8. filter-keyword의 현재 역할과 제약을 일관되게 정리하되 공급자 부분 문자열 row에 의존하지 마세요.
9. 기존 threads의 type만 백필하고 state, created_at, captured_at, state_changed_at과
   crawl-history는 변경하지 마세요.
10. 현재 stats 기반 필터 구조를 재사용하고 표시 라벨만 YouTube, Imgur로 명확히 하세요.
11. 외부 API, metadata table, queue, 전용 media card는 아직 구현하지 마세요.

Supabase migration은 현재 CLI help를 확인한 뒤 supabase migration new로 생성하세요.
운영 DB에는 적용하지 마세요.

필수 테스트:
- URL parser 정상·거부 matrix
- defineType provider 우선순위와 기존 ignore/keyword 회귀
- ingest_crawl_items의 youtube/imgur 보존과 media/issuelink 거부
- list_threads_page와 get_thread_stats의 타입 필터
- 백필 전후 상태별 건수와 타임스탬프 불변
- 기존 pipeline/API/cache 테스트

검증 순서:
1. 관련 Vitest
2. 관련 pgTAP
3. pnpm check
4. 가능하면 pnpm verify

마지막에 변경 파일, migration 계약, 백필 조건, 테스트 결과와 NOT VERIFIABLE 항목을 한국어로
보고하세요. commit/push는 하지 마세요.
```

Phase 1 완료 조건:

- 신규 수집과 백필 데이터가 `youtube`, `imgur`로 분류된다.
- `media`, `issuelink`는 여전히 거부된다.
- 상단 필터와 기존 type 필터가 함께 동작한다.
- 외부 API 의존성이 없다.

## Phase 2 프롬프트 — 메타데이터·durable queue DB 계약

```text
C:\Develop\applemint-v3에서 docs/MEDIA_THREAD_ENRICHMENT_PLAN.md의 Phase 2만 구현해주세요.
Phase 1의 migration, URL 분류, 타입 필터와 테스트가 현재 checkout에 존재하는지 먼저 확인하세요.
없거나 계약이 다르면 구현하지 말고 BLOCKED로 보고하세요.

목표:
- thread_media_metadata 1:1 요약 테이블
- media_enrichment_jobs lease 기반 durable queue
- 원자적 claim/complete/retry/fail RPC
- ingest_crawl_items 안에서 thread, history, pending metadata, queued job 원자 생성
- 기존 youtube/imgur thread의 metadata/job idempotent 백필
- 목록 RPC에서 nullable media_metadata 요약 반환

docs/MEDIA_THREAD_ENRICHMENT_PLAN.md의 D4, D5, D7, D8을 정확히 따르세요.

필수 DB 계약:
1. thread_media_metadata는 thread_id PK/FK ON DELETE CASCADE를 사용하세요.
2. provider, status, media_kind, duration, media_count, preview 개수 check를 두세요.
3. 외부 원시 API payload 전체를 저장하지 마세요.
4. media_enrichment_jobs는 thread_id당 현재 작업 하나, state, attempt_count, available_at,
   lease_token, lease_expires_at, last_error_code를 가집니다.
5. claim은 provider별 limit와 lease 시간을 받고 경쟁 worker가 같은 job을 가져가지 못하게 하세요.
6. 만료 lease는 재claim할 수 있어야 합니다.
7. complete/retry/fail은 matching lease_token이 없으면 상태를 변경하지 않아야 합니다.
8. authenticated owner는 metadata만 읽을 수 있고 job은 직접 읽거나 쓸 수 없게 하세요.
9. service_role만 job과 metadata를 갱신하게 하세요.
10. public schema의 새 테이블은 Data API 자동 노출에 기대지 말고 RLS와 grant를 명시하세요.
11. ingest 중 어느 단계가 실패해도 thread/history/metadata/job 부분 저장이 없어야 합니다.
12. 기존 youtube/imgur 행의 state와 모든 thread 시각을 보존한 채 metadata와 job만 백필하세요.
13. list_threads_page는 기존 cursor, look-ahead, type 필터를 유지하면서 nullable
    media_metadata jsonb를 반환하세요.
14. 함수 반환형 변경 시 안전한 drop/recreate와 권한 복구를 포함하세요.
15. 아직 외부 API 호출, worker Route Handler, 전용 UI 카드는 구현하지 마세요.

TypeScript 계약:
- ThreadItemType에 명시적인 nullable media metadata 타입 추가
- API 응답 테스트 갱신
- React Query key와 optimistic state 이동이 metadata를 보존하도록 테스트

필수 pgTAP:
- table/FK/check/index/RLS/grant
- owner metadata read와 job direct access 거부
- 동시 claim과 SKIP LOCKED 동작
- lease 만료 후 재claim
- 잘못된 token의 complete/retry/fail 거부
- ingest 중복과 rollback 원자성
- 백필 idempotence
- cursor와 상태 이동 회귀

검증은 관련 pgTAP과 Vitest를 먼저 실행한 뒤 pnpm check, 가능하면 pnpm verify 순서로 수행하세요.
운영 DB에는 적용하지 말고 commit/push도 하지 마세요.
```

Phase 2 완료 조건:

- API key가 전혀 없어도 DB 계약과 기존 화면이 정상 동작한다.
- 신규 YouTube·Imgur ingest가 pending metadata와 queued job을 만든다.
- 외부 worker가 없어도 크롤링 성공 상태에 영향이 없다.

## Phase 3 프롬프트 — YouTube 메타데이터 worker

```text
C:\Develop\applemint-v3에서 docs/MEDIA_THREAD_ENRICHMENT_PLAN.md의 Phase 3만 구현해주세요.
Phase 1·2의 URL 분류, metadata, queue, RPC와 테스트가 현재 checkout에 존재하는지 먼저 확인하세요.

목표:
- YouTube video ID와 URL 종류 정규화
- 공식 videos.list adapter
- batch metadata 수집
- duration 정수 초 변환
- queue lease 기반 완료·재시도·종단 실패
- 내부 인증 Route Handler

필수 구현:
1. 공식 YouTube Data API videos.list를 사용하고 part는 필요한
   snippet,contentDetails,status로 제한하세요.
2. 여러 claimed job의 video ID를 하나의 요청으로 묶고 중복 ID를 제거하세요.
3. title, thumbnail, channelTitle, duration, live/upcoming 상태만 정규화해 저장하세요.
4. ISO 8601 duration parser는 day/hour/minute/second와 잘못된 값을 명시적으로 처리하세요.
5. video ID가 없는 YouTube URL은 unsupported 종단 상태로 처리하세요.
6. 응답에 없는 ID는 unavailable로 처리하되 원인을 단정하는 사용자 문구는 피하세요.
7. timeout, 네트워크 오류, HTTP 429, 5xx는 retry와 available_at으로 보존하세요.
8. 잘못된 ID와 최대 시도 초과는 무한 재시도하지 마세요.
9. worker는 provider=youtube job만 claim하세요.
10. YOUTUBE_API_KEY가 없거나 비어 있으면 503으로 fail closed하고 job을 claim하지 마세요.
11. CRAWL_INTERNAL_SECRET과 기존 constant-time helper를 재사용하세요.
12. proxy.ts에서 worker 경로의 Authorization/header/body가 보존되게 하세요.
13. service role은 서버 모듈 안에서만 사용하고 클라이언트 bundle에 들어가지 않게 하세요.
14. API key, Authorization header, 원시 API 응답을 로그에 남기지 마세요.
15. 크롤링 pipeline 안에서는 YouTube API를 호출하지 마세요.
16. 자동 Cron 연결과 YouTube 전용 UI는 아직 구현하지 마세요.

테스트는 실제 YouTube 네트워크에 의존하지 않는 fixture/mock 기반으로 작성하세요.

필수 테스트:
- URL/video ID 종류
- duration parser
- batch 성공과 중복 ID
- 응답 일부 누락
- live/upcoming
- 429, 5xx, timeout, network error
- 잘못된 internal secret
- API key 누락 시 queue 미변경
- matching lease token만 complete/retry
- 크롤링 run 상태 비영향

공식 문서를 현재 시점에 다시 확인하고 사용한 endpoint/part/quota 근거를 결과에 링크하세요.
targeted test, pnpm check, 가능하면 pnpm verify를 실행하세요.
운영 API를 대상으로 smoke하거나 commit/push하지 마세요.
```

Phase 3 완료 조건:

- fixture 기반 YouTube batch가 metadata를 올바르게 채운다.
- 오류가 durable retry 또는 명시적 종단 상태로 남는다.
- 자동 실행과 UI 없이도 내부 worker를 로컬에서 검증할 수 있다.

## Phase 4 프롬프트 — YouTube 전용 카드

```text
C:\Develop\applemint-v3에서 docs/MEDIA_THREAD_ENRICHMENT_PLAN.md의 Phase 4만 구현해주세요.
Phase 1~3의 목록 응답과 YouTube metadata 계약이 현재 checkout에 존재하는지 먼저 확인하세요.

목표:
- type=youtube 스레드의 전용 카드
- 썸네일, 공식 제목, 채널명, 영상 길이, LIVE·예정·Shorts 표시
- pending, failed, unavailable, unsupported 상태
- 기존 상태 이동과 캐시 계약 유지

필수 UI 계약:
1. thread 행은 복제하지 말고 기존 DefaultThreadItem 흐름에서 type별 renderer를 선택하세요.
2. 공식 제목을 우선하되 threads.title을 수집 문맥으로 보존하세요.
3. metadata 제목이 없으면 결정론적인 한국어 fallback을 사용하세요.
4. duration은 MM:SS 또는 H:MM:SS로 표시하세요.
5. live/upcoming은 숫자 길이 대신 명시적 배지를 우선하세요.
6. pending은 layout shift가 적은 skeleton을 사용하세요.
7. unavailable, unsupported, failed를 서로 구분하세요.
8. Save, Trash, Restore, Copy, Open의 기존 API와 optimistic cache를 재사용하세요.
9. 일반 스레드 카드를 변경하거나 회귀시키지 마세요.
10. 모바일은 단일 열, 넓은 화면은 읽기 쉬운 grid를 사용하세요.
11. 이미지 alt, 버튼 이름, focus 상태를 포함한 기본 접근성을 지키세요.
12. 원격 이미지 hostname은 YouTube와 필요한 Imgur 후보를 최소 allowlist로 제한하세요.
13. 새 UI 패키지는 추가하지 마세요.
14. Imgur 카드와 자동 Cron은 아직 구현하지 마세요.

필수 테스트:
- ready video, Shorts, live, upcoming
- pending, failed, unavailable, unsupported
- metadata 없는 legacy row
- 일반 카드 회귀
- 필터별 목록과 통계 cache
- inbox→saved→trash 및 trash→inbox 이동
- 이미지 fallback과 접근 가능한 이름

targeted Vitest를 먼저 실행하고 pnpm check, 가능하면 pnpm verify를 실행하세요.
필요하면 사용자 주도 E2E 항목을 제안하되 자동으로 운영 환경을 조작하지 마세요.
commit/push는 하지 마세요.
```

Phase 4 완료 조건:

- YouTube 필터에서 링크를 열지 않고 제목·썸네일·길이를 확인할 수 있다.
- 일반 스레드와 상태 이동 동작이 유지된다.

## Phase 5 프롬프트 — Imgur 메타데이터·전용 카드

```text
C:\Develop\applemint-v3에서 docs/MEDIA_THREAD_ENRICHMENT_PLAN.md의 Phase 5만 구현해주세요.
Phase 1~4의 metadata queue, 내부 worker, 목록 응답, type renderer 계약을 먼저 확인하세요.

목표:
- Imgur image, album, gallery, direct file 정규화
- 공식 Imgur API metadata 수집
- 제목·대표 이미지·이미지 수·최대 4개 preview 저장
- 링크를 열지 않고 판단 가능한 Imgur 카드와 미리보기 Drawer

필수 서버 계약:
1. IMGUR_CLIENT_ID는 서버 전용이며 NEXT_PUBLIC_ 접두사를 사용하지 마세요.
2. 공개 read-only 요청은 공식 Client-ID Authorization 형식을 사용하세요.
3. image, album, album images와 gallery URL 차이를 명시적으로 처리하세요.
4. worker는 provider=imgur job만 claim하고 bounded concurrency를 적용하세요.
5. title, description, cover, media count, preview 최대 4개만 정규화해 저장하세요.
6. 전체 원시 응답과 전체 대형 앨범 URL 배열을 저장하지 마세요.
7. 제목이 없으면 원문 title, Imgur 앨범·이미지 fallback 순서를 적용하세요.
8. 429, 5xx, timeout, network error는 retry하고 404·잘못된 ID는 종단 처리하세요.
9. IMGUR_CLIENT_ID 누락 시 503으로 fail closed하고 job을 claim하지 마세요.
10. API credential과 원시 응답을 로그에 남기지 마세요.
11. 크롤링 pipeline 안에서 Imgur API를 호출하지 마세요.

필수 UI 계약:
1. type=imgur에만 전용 카드를 사용하세요.
2. 대표 이미지 또는 최대 4개 preview grid를 보여주세요.
3. 앨범 이미지 수와 image/album/gallery/GIF/video 종류를 표시하세요.
4. 제목이 없어도 Untitled 대신 결정론적 fallback을 표시하세요.
5. Drawer에서 preview를 확인하고 원본 Imgur 열기 작업을 제공하세요.
6. 기존 Save, Trash, Restore, Copy 동작을 재사용하세요.
7. 일반·YouTube 카드와 필터 캐시를 회귀시키지 마세요.
8. 새 UI 패키지는 추가하지 마세요.

필수 fixture/test:
- image, album, gallery, i.imgur direct file
- title 없음, description만 있음, 빈 album
- GIF·video, preview 4개 초과
- 404, 429, 5xx, timeout
- Client-ID 누락 시 queue 미변경
- ready·pending·failed·unavailable UI
- Drawer 접근성과 상태 이동

공식 Imgur API 문서를 현재 시점에 다시 확인하고 결과에 링크하세요.
targeted test, pnpm check, 가능하면 pnpm verify를 실행하세요.
자동 Cron 연결과 운영 smoke는 아직 하지 말고 commit/push도 하지 마세요.
```

Phase 5 완료 조건:

- Imgur 필터에서 제목, 대표 이미지와 앨범 규모를 확인할 수 있다.
- 대부분의 일상 확인이 외부 페이지를 열지 않고 가능하다.

## Phase 6 프롬프트 — 자동 실행·백필·운영 최종 게이트

```text
C:\Develop\applemint-v3에서 docs/MEDIA_THREAD_ENRICHMENT_PLAN.md의 Phase 6만 구현해주세요.
Phase 1~5가 현재 checkout에 모두 존재하고 targeted test를 통과했는지 먼저 확인하세요.
하나라도 없거나 실패하면 자동 실행을 추가하지 말고 BLOCKED로 보고하세요.

목표:
- media worker의 Supabase Cron/pg_net 자동 호출
- fail-closed 설정과 수동 smoke 절차
- 기존 youtube/imgur metadata/job 백필 확인
- 운영 조회·문서·전체 검증

필수 계약:
1. worker 자동 호출은 기존 crawl scheduler와 별도 job으로 구성하세요.
2. 초기 migration에서는 자동 실행을 disabled 상태로 두세요.
3. 기존 Vault의 app base URL과 internal secret을 재사용하고 값을 migration에 넣지 마세요.
4. worker endpoint의 401, 403, 404, 429, 5xx를 운영에서 구분 가능하게 하세요.
5. queue lease 만료와 retry가 dispatch 실패를 복구할 수 있게 하세요.
6. 자동 media worker 문제로 기존 crawl scheduler를 끄지 마세요.
7. pending, processing, retry, dead, oldest available_at, 최대 지연을 확인하는 읽기 전용 운영 쿼리를
   docs/CRAWL_SCHEDULING.md 또는 새 운영 섹션에 추가하세요.
8. 운영 적용 전 기존 youtube/imgur thread 수, metadata 수, job 수와 상태별 수를 대조하세요.
9. README의 아키텍처, 환경 변수, 검증 명령과 새 media 흐름을 갱신하세요.
10. Supabase 2026 Data API 노출 변경과 현재 Cron API 변경을 공식 문서·changelog에서 재확인하세요.
11. security/performance advisor 결과를 검토하고 새 문제를 해결하세요.
12. 운영 DB 변경이나 scheduler 활성화는 사용자의 명시적 승인 없이는 수행하지 마세요.

검증 순서:
1. 모든 관련 Vitest
2. 모든 pgTAP
3. pnpm check
4. pnpm verify
5. 가능하면 사용자가 승인한 로컬 pnpm test:e2e
6. 로컬 또는 승인된 비운영 환경에서 내부 worker smoke

최종 보고 형식:
- 구현 완료 범위
- migration과 보안 계약
- YouTube·Imgur 처리 결과
- 전체 검증 결과
- advisor 결과
- 운영 반영 전 체크리스트
- 자동 실행 활성화 명령이 아니라 승인 후 수행할 절차
- 롤백 절차
- NOT VERIFIABLE 항목

commit, push, PR 생성과 운영 scheduler 활성화는 별도 요청이 없으면 하지 마세요.
```

Phase 6 완료 조건:

- 전체 검증이 통과한다.
- worker 자동 실행은 배포 후 수동 smoke 전까지 비활성이다.
- 운영 활성화와 롤백 절차가 문서화됐다.
- 기존 크롤러와 스레드 상태 이동 계약이 유지된다.

## 후속 선택 프롬프트 — 운영 반영 전 최종 점검

모든 구현이 끝난 뒤 운영 반영 직전에만 사용한다.

```text
C:\Develop\applemint-v3의 YouTube·Imgur 스레드 확장 운영 반영 준비도를 읽기 전용으로 최종 점검해주세요.

docs/MEDIA_THREAD_ENRICHMENT_PLAN.md와 구현된 migration, worker, UI, 테스트를 대조하세요.
코드, DB, GitHub, Supabase, Vercel 설정을 변경하지 마세요.

반드시 확인할 항목:
- 현재 branch, HEAD, dirty 상태
- pnpm verify 결과
- migration 순서와 원격 미적용 여부
- 운영 기존 youtube/imgur 행 수와 상태별 분포
- 백필 예상 metadata/job 수
- Vault/환경 변수는 존재 여부와 길이만 확인하고 값은 출력 금지
- worker Cron 초기 disabled
- RLS/grant와 advisor
- crawl scheduler와 media worker의 독립 중지 가능성
- 수동 smoke, 활성화, 관찰, 롤백 순서

결과를 GO / NO-GO로 시작하고, 차단 항목과 승인 후 실행할 정확한 순서를 한국어로 제공하세요.
아직 운영 변경을 수행하지 마세요.
```
