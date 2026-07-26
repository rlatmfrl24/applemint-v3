# YouTube·Imgur 스레드 분류 및 메타데이터 확장 구현 계획

- 문서 상태: 구현 전 기준안
- 작성일: 2026-07-27
- 대상 저장소: `C:\Develop\applemint-v3`
- 연계 문서: `docs/MEDIA_THREAD_ENRICHMENT_PROMPTS.md`

## 1. 목표

현재 수집되는 YouTube와 Imgur URL을 일반 스레드와 구분하고, 링크를 일일이 열지 않아도 내용을
판단할 수 있도록 다음 기능을 순차 도입한다.

- 메인 화면 상단에 `YouTube`, `Imgur` 필터를 제공한다.
- YouTube 스레드에 공식 제목, 썸네일, 채널명, 영상 길이와 라이브 상태를 표시한다.
- Imgur 스레드에 제목, 대표 이미지, 앨범 이미지 수와 제한된 미리보기를 표시한다.
- 외부 API 오류가 전체 크롤링 실패로 전파되지 않도록 메타데이터 수집을 비동기로 분리한다.
- 기존 `inbox`·`saved`·`trash` 상태, 수집 시각, 영구 중복 방지 이력을 보존한다.

이 문서는 “수집된 URL 자체가 YouTube 또는 Imgur인 항목”을 대상으로 한다. Arcalive나
Battlepage 게시글 본문을 추가로 열어 내부 링크를 추출하는 기능은 별도 범위다.

## 2. 현재 확인된 상태

### 2.1 운영 데이터 스냅샷

메인 스레드에서 2026-07-27에 확인한 운영 스냅샷은 다음과 같다. 이 값은 시점 의존적이므로
운영 반영 직전에 같은 조건으로 다시 측정한다.

| 공급자 | 전체 | 제목 없음 또는 URL과 동일 | 주요 URL 형태 |
| --- | ---: | ---: | --- |
| Imgur | 279 | 112 | 앨범 268, 기타 8, 직접 파일 3 |
| YouTube | 90 | 36 | watch 49, youtu.be 26, Shorts 9, 기타 6 |

- 확인된 항목은 모두 Insagirl에서 수집됐다.
- 당시에는 모두 `type='normal'`, `state='trash'`였다.
- 기존 상태를 이동하지 않고 분류와 메타데이터만 백필해야 한다.

### 2.2 코드·DB 계약

- `app/api/crawl/pipeline-helpers.ts`의 `defineType`은 현재 URL 문자열과
  `filter-keyword`를 단순 부분 일치시킨다.
- `app/api/crawl/pipeline.ts`는 크롤링, 필터링, 영구 이력 제외, 분류,
  `ingest_crawl_items` 호출과 run 종료를 소유한다.
- `public.threads`가 스레드의 단일 원본이며 상태 이동은 같은 행의 `state`만 변경한다.
- `list_threads_page`와 `get_thread_stats`는 `type` 필터를 이미 지원한다.
- `app/main/threads/thread-list.tsx`는 통계에서 반환된 타입을 상단 필터로 동적 렌더링한다.
- 현재 DB 제약은 `media`, `youtube`, `issuelink` 타입을 금지한다.
- `ingest_crawl_items`도 `media`, `youtube`를 `normal`로 정규화한다.
- 과거의 `media`·`youtube` 탭과 `sub_url` 확장은 제거됐으며 그대로 복구하지 않는다.

### 2.3 제목 누락 원인

`app/api/crawl/insagirl-parser.ts`는 원문 문자열에서 URL을 제거한 나머지를 제목으로 사용한다.
원문이 URL만 포함하면 `title=null`이 되며 현재 카드는 이를 `Untitled`로 표시한다. 외부 서비스의
공식 제목은 별도 메타데이터로 보존하고, 수집 원문 제목을 덮어쓰지 않아야 한다.

## 3. 고정 설계 결정

### D1. 스레드를 복제하지 않는다

YouTube·Imgur 항목도 기존 `threads` 한 행을 사용한다. 공급자별 별도 테이블에 스레드 자체를
복제하면 Save·Trash·Restore 상태와 낙관적 캐시가 서로 어긋날 수 있다. 화면에서만 공급자 전용
카드로 렌더링한다.

### D2. 활성 분류값은 `youtube`, `imgur`다

- `threads.type='youtube'`
- `threads.type='imgur'`
- 포괄적인 `media` 타입은 계속 폐기 상태로 유지한다.
- `issuelink`도 계속 폐기 상태로 유지한다.

현재 필터와 인덱스를 재사용하므로 별도 `provider` 필터 축을 추가하지 않는다. 수집 출처는
기존 `tag`에 남아 있으므로 URL 공급자 분류와 충돌하지 않는다.

### D3. 공급자 판정은 정확한 URL 파싱을 사용한다

`value.includes(...)`만으로 YouTube·Imgur를 판정하지 않는다. URL을 파싱한 뒤 소문자로 정규화한
hostname과 pathname을 기준으로 판정한다.

| 공급자 | 허용 hostname 예시 | 대표 형태 |
| --- | --- | --- |
| YouTube | `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be` | `watch?v=`, `shorts/`, `live/`, `embed/`, 짧은 URL |
| Imgur | `imgur.com`, `www.imgur.com`, `i.imgur.com` | `/a/`, `/gallery/`, 이미지 페이지, 직접 파일 |

- `youtube.com.evil.example` 같은 유사 hostname은 거부한다.
- URL query나 fragment에 `youtube.com` 또는 `imgur.com`이 들어간 일반 URL은 공급자로 분류하지 않는다.
- YouTube 도메인이지만 video ID를 얻을 수 없는 채널·재생목록 URL은 `youtube`로 격리하되
  메타데이터 상태를 `unsupported`로 기록한다.
- 공급자 판정을 먼저 하고, 그 외 URL에만 기존 `filter-keyword` 분류를 적용한다.

### D4. 외부 메타데이터는 별도 테이블에 저장한다

`threads.title`은 수집 원문 문맥으로 보존한다. 공식 YouTube·Imgur 제목과 미리보기 정보는
`thread_media_metadata`에 저장한다. 과거처럼 모든 URL을 `threads.sub_url` 배열에 넣지 않는다.

권장 요약 스키마:

| 컬럼 | 용도 |
| --- | --- |
| `thread_id bigint primary key` | `threads(id)` 1:1, 삭제 시 cascade |
| `provider text` | `youtube`, `imgur` |
| `external_id text` | video ID, image hash, album hash |
| `media_kind text` | `video`, `short`, `live`, `image`, `album`, `gallery`, `unsupported` |
| `status text` | `pending`, `ready`, `unavailable`, `unsupported`, `failed` |
| `title text` | 공급자 공식 제목 |
| `channel_title text` | YouTube 채널명 |
| `thumbnail_url text` | 대표 이미지 |
| `duration_seconds integer` | YouTube 영상 길이 |
| `live_status text` | `none`, `live`, `upcoming` |
| `media_count integer` | Imgur 이미지 수 |
| `preview_urls text[]` | 최대 4개 미리보기 URL |
| `last_error_code text` | 비밀·응답 본문을 제외한 안전한 오류 코드 |
| `fetched_at timestamptz` | 마지막 성공·종단 상태 확인 시각 |
| `created_at`, `updated_at` | 감사 시각 |

주요 제약:

- `duration_seconds >= 0`
- `media_count >= 0`
- `preview_urls`는 최대 4개
- provider·status·media_kind는 허용 목록 check
- 외부 API의 원시 응답 전체는 저장하지 않는다.

### D5. 메타데이터 작업은 명시적 durable queue로 관리한다

초기 구현은 새 확장 도입 없이 pgTAP으로 직접 검증 가능한 `media_enrichment_jobs` 테이블을
사용한다. 향후 처리량이나 운영 요구가 커지면 Supabase Queues(PGMQ)로 교체할 수 있지만 MVP
범위에는 포함하지 않는다.

- Supabase Queues 참고: https://supabase.com/docs/guides/queues

권장 작업 컬럼:

| 컬럼 | 용도 |
| --- | --- |
| `thread_id bigint primary key` | 한 스레드당 현재 작업 하나 |
| `provider text` | claim 대상 공급자 |
| `state text` | `queued`, `processing`, `retry`, `succeeded`, `dead` |
| `attempt_count integer` | 0 이상의 누적 시도 수 |
| `available_at timestamptz` | 다음 실행 가능 시각 |
| `lease_token uuid` | worker 소유권 검증 |
| `lease_expires_at timestamptz` | 비정상 종료 복구 경계 |
| `last_error_code text` | 안전한 분류 코드 |
| `created_at`, `updated_at` | 운영 시각 |

필수 RPC:

- `claim_media_enrichment_jobs(provider, limit, lease_seconds)`
- `complete_media_enrichment_job(thread_id, lease_token, metadata)`
- `retry_media_enrichment_job(thread_id, lease_token, error_code, available_at)`
- `fail_media_enrichment_job(thread_id, lease_token, error_code)`

claim은 `FOR UPDATE SKIP LOCKED` 또는 동등한 원자적 패턴을 사용한다. lease token이 다른 완료·재시도
요청은 실패해야 한다. 만료된 `processing` 작업은 다시 claim할 수 있어야 한다.

재시도 대상:

- 네트워크 오류
- timeout
- HTTP 429
- 공급자 HTTP 5xx

종단 상태:

- 잘못된 video/image/album ID
- 삭제·비공개로 확인된 YouTube 영상
- 지원하지 않는 YouTube URL 종류
- 정해진 최대 시도 횟수 초과

### D6. 크롤링 요청 안에서 외부 API를 호출하지 않는다

현재 소스별 실행 예산은 45초다. 크롤링 파이프라인에서는 다음까지만 원자적으로 처리한다.

1. URL 정확 분류
2. `crawl-history` claim
3. `threads` 삽입
4. `thread_media_metadata(status='pending')` 생성
5. `media_enrichment_jobs(state='queued')` 생성

YouTube·Imgur API 호출은 별도 내부 Route Handler가 queue를 claim해 수행한다. 외부 API 실패가
크롤링 run의 `partial` 또는 `failed` 판정에 포함되면 안 된다.

### D7. 보안 경계

- `YOUTUBE_API_KEY`, `IMGUR_CLIENT_ID`는 서버 전용 환경 변수다.
- `NEXT_PUBLIC_` 접두사를 사용하지 않는다.
- worker Route Handler는 기존 `CRAWL_INTERNAL_SECRET`과 constant-time 비교 헬퍼를 재사용한다.
- `proxy.ts`는 내부 worker 경로의 원본 인증 헤더와 JSON body를 보존해야 한다.
- `thread_media_metadata`는 인증된 Applemint 소유자만 읽고 service role만 쓸 수 있게 RLS와 grant를
  명시한다.
- `media_enrichment_jobs`는 사용자 클라이언트에 노출하지 않고 service role만 접근한다.
- 새 public 테이블은 Data API 자동 노출 여부에 기대지 않고 RLS·grant를 명시한다.
- 오류 로그와 DB에는 API key, Authorization header, 외부 원시 응답을 남기지 않는다.

Supabase Data API 보안 참고:

- https://supabase.com/docs/guides/api/securing-your-api

### D8. 목록 응답은 메타데이터 요약을 포함한다

`list_threads_page`가 각 스레드와 함께 nullable `media_metadata jsonb` 요약을 반환하도록 확장한다.
별도 N+1 조회를 만들지 않는다.

- `get_thread_stats`의 `type` 집계 계약은 유지한다.
- 복합 커서 `(state_changed_at, id)`와 look-ahead 1행 계약을 유지한다.
- 함수 반환형 변경은 기존 함수를 안전하게 drop/recreate하고 권한을 복구해야 한다.
- TypeScript의 `ThreadItemType`, API 테스트, React Query 캐시 테스트를 함께 갱신한다.

### D9. 공급자 공식 제목은 원문 제목을 덮어쓰지 않는다

표시 우선순위:

1. `media_metadata.title`
2. 의미 있는 `threads.title`
3. 공급자별 안전한 대체 제목

대체 제목 예시:

- `YouTube 영상`
- `확인할 수 없는 YouTube 영상`
- `Imgur 앨범 · 12개`
- `Imgur 이미지 · {external_id}`

## 4. 공급자별 처리 계약

### 4.1 YouTube

공식 API:

- `GET https://www.googleapis.com/youtube/v3/videos`
- `part=snippet,contentDetails,status`
- `id`는 comma-separated video ID 목록

저장 필드:

- `snippet.title`
- 가능한 가장 적합한 `snippet.thumbnails.*.url`
- `snippet.channelTitle`
- `snippet.liveBroadcastContent`
- `contentDetails.duration`
- 필요한 경우 `status`의 공개 상태

`contentDetails.duration`은 ISO 8601 문자열 그대로 UI에 전달하지 않고 정수 초로 변환한다.
여러 작업의 video ID를 묶어 호출하고, 중복 ID는 한 요청 안에서 제거한다. 응답에 없는 ID는
삭제·비공개·존재하지 않음으로 구분 가능한 범위까지만 `unavailable`로 기록한다.

표시 계약:

- 16:9 썸네일
- 우측 하단 `MM:SS` 또는 `H:MM:SS`
- `LIVE`, `예정`, `Shorts` 배지
- 공식 제목 2줄, 채널명 1줄
- `pending` skeleton
- `failed` 재시도 가능 상태
- `unavailable` 명시적 안내

공식 근거:

- https://developers.google.com/youtube/v3/docs/videos/list
- https://developers.google.com/youtube/v3/docs/videos

### 4.2 Imgur

공식 API:

- `GET https://api.imgur.com/3/image/{imageHash}`
- `GET https://api.imgur.com/3/album/{albumHash}`
- `GET https://api.imgur.com/3/album/{albumHash}/images`
- 공개 read-only 요청은 `Authorization: Client-ID {clientId}` 사용

저장 필드:

- API 제목 또는 설명 중 표시 가능한 값
- 대표 이미지 URL
- 이미지 수
- 최대 4개 미리보기 URL
- 이미지·앨범·갤러리 종류

표시 계약:

- 대표 이미지 또는 최대 4개 미리보기 그리드
- `앨범 · N개`, `이미지`, `GIF`, `영상` 배지
- 제목이 없으면 결정론적 대체 제목
- `미리보기` Drawer와 `Imgur에서 열기`
- 초기 단계에서는 전체 앨범 URL을 thread 행에 저장하지 않는다.
- 전체 갤러리가 실제로 필요해진 뒤에만 별도 asset 테이블을 검토한다.

공식 근거:

- https://apidocs.imgur.com/

## 5. 순차 구현 단계와 완료 게이트

각 단계는 앞 단계가 현재 checkout에 존재하고 해당 게이트를 통과한 뒤에만 시작한다.

### Phase 0. 구현 전 기준선 확인

작업:

- branch, HEAD, dirty worktree 확인
- 현재 migration·RPC·필터·캐시 계약 재확인
- 운영 데이터는 읽기 전용 쿼리로 다시 측정하되 시각을 기록
- API key와 Client-ID의 존재 여부만 확인하고 값은 출력하지 않음
- 현재 로컬 Supabase와 Docker 사용 가능 여부 확인

완료 게이트:

- 변경 예정 파일과 migration 영향 범위가 식별됨
- 기존 사용자 변경과 충돌 여부가 보고됨
- 구현은 아직 시작하지 않음

### Phase 1. 정확한 URL 분류·필터·기존 데이터 백필

작업:

- YouTube·Imgur URL parser와 단위 테스트
- provider-first `defineType` 적용
- DB 제약에서 `youtube`를 활성화하고 `imgur`를 허용
- `media`, `issuelink`는 계속 금지
- `ingest_crawl_items`가 `youtube`, `imgur`를 보존하도록 변경
- 기존 정확한 공급자 URL의 `type`만 idempotent 백필
- 상태·`created_at`·`captured_at`·`state_changed_at`·`crawl-history`는 변경하지 않음
- 상단 필터 라벨을 `YouTube`, `Imgur`로 표시

완료 게이트:

- URL 변형과 유사 hostname 테스트 통과
- 새 ingest가 두 타입을 보존
- 목록·통계 RPC 필터 테스트 통과
- 기존 상태별 건수와 타임스탬프 불변 확인
- 외부 API 호출과 메타데이터 컬럼은 아직 없음

### Phase 2. 메타데이터·queue DB 계약

작업:

- `thread_media_metadata`, `media_enrichment_jobs` migration
- RLS, grant, check, FK, covering index
- claim·complete·retry·fail RPC
- `ingest_crawl_items`가 신규 media thread와 pending job을 같은 트랜잭션으로 생성
- Phase 1에서 분류한 기존 행에 metadata와 job을 idempotent 백필
- `list_threads_page`에 nullable metadata 요약 추가
- TypeScript/API/캐시 계약 동기화

완료 게이트:

- pgTAP에서 권한, claim 경쟁, lease 만료, 잘못된 token, rollback 검증
- ingest 실패 시 thread·metadata·job·history가 부분 저장되지 않음
- 기존 cursor와 상태 이동 테스트 통과
- 아직 외부 API 호출과 UI 전용 카드는 없음

### Phase 3. YouTube 메타데이터 worker

작업:

- YouTube URL에서 video ID와 종류를 정규화
- YouTube API adapter와 ISO 8601 duration parser
- 여러 ID를 묶는 batch 요청
- timeout, 429, 5xx 재시도 분류
- 삭제·비공개·지원하지 않는 URL 종단 상태
- 내부 인증 Route Handler
- worker 경로의 proxy 우회와 테스트
- API key가 없으면 fail closed하고 job을 소비하지 않음

완료 게이트:

- 외부 네트워크 없는 fixture 단위 테스트
- 혼합 성공·누락·오류 batch가 각 job에 정확히 반영
- lease token 불일치가 완료를 막음
- 크롤링 run 결과는 YouTube API 실패와 무관

### Phase 4. YouTube 전용 카드

작업:

- `youtube` 타입에 전용 카드 사용
- 썸네일, 공식 제목, 채널명, 길이, LIVE·예정·Shorts 배지
- pending·failed·unavailable·unsupported 상태
- 기존 Save·Trash·Restore·Copy 동작 재사용
- 원격 이미지 hostname을 최소 allowlist로 제한
- 모바일 단일 열, 넓은 화면의 적절한 grid

완료 게이트:

- 일반 스레드 카드 회귀 없음
- 모든 상태의 UI 단위 테스트
- 낙관적 이동 후 필터별 목록·통계 캐시 일관성
- 키보드 접근과 이미지 대체 텍스트 확인

### Phase 5. Imgur 메타데이터와 전용 카드

작업:

- image·album·gallery·direct file URL 정규화
- Imgur API adapter
- 대표 이미지, 개수, 최대 4개 preview 저장
- 제목 fallback 규칙
- bounded concurrency와 재시도
- Imgur 전용 카드와 미리보기 Drawer

완료 게이트:

- album/image/gallery fixture 테스트
- 제목 없는 200 응답, 빈 앨범, GIF·영상, 404, 429, timeout 처리
- preview 4개 제한과 media_count 정확성
- Drawer를 열지 않아도 카드에서 기본 판단 가능

### Phase 6. 자동 실행·운영·최종 게이트

작업:

- worker 자동 호출을 위한 Supabase Cron·`pg_net` 연결
- 기존 Vault base URL과 internal secret 사용
- 자동 실행은 초기 `disabled` 상태로 배포
- 기존 media thread의 metadata/job 백필 건수 재확인
- 수동 worker smoke 후 자동 실행 활성화
- queue 상태·지연·재시도·dead 건수 운영 조회 추가
- README와 운영 문서 갱신

완료 게이트:

- `pnpm verify`
- 필요한 경우 사용자 주도 `pnpm test:e2e`
- Supabase security·performance advisor 확인
- YouTube·Imgur 샘플의 필터·카드·상태 이동 smoke
- scheduler를 켜기 전 pending job 수와 처리량 기록
- 활성화 후 중복 처리, lease 잔존, API key 노출이 없음

Supabase 변경사항 확인:

- https://supabase.com/changelog?types=breaking-change

## 6. 롤아웃과 안전장치

### 6.1 배포 순서

1. Phase 1 분류와 필터를 배포한다.
2. Phase 2 DB 계약을 적용하되 worker는 아직 호출하지 않는다.
3. Phase 3 YouTube worker를 수동으로 소량 실행한다.
4. Phase 4 YouTube UI를 배포한다.
5. Phase 5 Imgur worker·UI를 소량 검증한다.
6. Phase 6에서만 자동 worker 호출을 활성화한다.

### 6.2 실패 시 동작

- 외부 API 설정 누락: worker `503`, queue를 claim하지 않음
- 일시 오류: `retry`와 `available_at` 기록
- 종단 오류: metadata 상태를 명확히 표시하고 무한 재시도하지 않음
- worker 장애: lease 만료 후 다시 claim
- UI metadata 없음: 일반 카드 또는 공급자 fallback 카드로 표시
- 자동 실행 문제: media worker Cron만 중지하고 기존 크롤러 scheduler는 유지

### 6.3 롤백 원칙

- `threads`, `crawl-history` 데이터를 삭제하지 않는다.
- 분류 롤백이 필요하면 `youtube`, `imgur`를 `normal`로 되돌리되 상태와 시각은 보존한다.
- metadata·job 테이블 제거는 worker 중지와 읽기 경로 제거가 먼저 완료된 후에만 검토한다.
- 외부 API 장애를 이유로 크롤링 scheduler를 중지하지 않는다.
- old `media`·`sub_url` 구조로 되돌아가지 않는다.

## 7. 검증 매트릭스

| 계층 | 필수 검증 |
| --- | --- |
| URL parser | 정상 변형, 대소문자, query·fragment, 유사 hostname, 잘못된 ID |
| pipeline | provider 우선 분류, ignore 유지, history 제외, 타입 보존 |
| DB ingest | thread·history·metadata·job 원자성, 중복 ingest |
| queue | 경쟁 claim, lease 만료, token 불일치, retry, dead |
| YouTube | batch 성공·부분 누락·429·5xx·timeout·duration |
| Imgur | image·album·gallery·빈 응답·제목 없음·preview 제한 |
| API | owner 권한, 내부 secret, 잘못된 요청, 응답 직렬화 |
| cache | 필터별 목록과 통계, 상태 이동, rollback |
| UI | ready·pending·failed·unavailable·unsupported, responsive, 접근성 |
| 전체 | `pnpm verify`, 선택적 E2E, advisor, 운영 smoke |

## 8. 구현 시 변경 가능성이 높은 파일

실제 구현 전에 현재 checkout을 다시 확인하며, 아래 목록을 고정 파일 목록으로 간주하지 않는다.

- `app/api/crawl/pipeline-helpers.ts`
- `app/api/crawl/pipeline.ts`
- `app/api/crawl/internal-auth.ts`
- `app/api/thread-list.ts`
- `app/api/thread-stats.ts`
- `app/api/media/**` 또는 동등한 새 서버 모듈
- `app/main/threads/thread-list.tsx`
- `app/main/threads/thread-item.tsx`
- `app/main/thread-card.tsx`
- `lib/type-defs.ts`
- `lib/thread-list-contract.ts`
- `lib/thread-query-options.ts`
- `lib/thread-query-cache.ts`
- `proxy.ts`
- `supabase/migrations/**`
- `supabase/tests/**`
- 관련 Vitest·Playwright 테스트
- `README.md`
- `docs/CRAWL_SCHEDULING.md`

## 9. 비범위

- 게시글 상세 페이지 안의 YouTube·Imgur 링크 추출
- YouTube 업로드·OAuth
- Imgur 업로드·계정 OAuth
- 영상·이미지 파일 자체를 Supabase Storage에 복제
- 전체 Imgur 앨범 asset의 영구 저장
- 조회수·좋아요·댓글 수 수집
- 일반 웹 페이지 Open Graph 범용 확장
- old `media` 타입과 `sub_url` 복구

## 10. 구현 시작 기준

다음 조건을 모두 충족할 때 Phase 1을 시작한다.

- 이 문서의 D1~D9 결정에 변경 요청이 없다.
- 현재 branch와 dirty worktree가 확인됐다.
- local Supabase·Docker 검증 가능 여부가 확인됐다.
- 운영 DB에 직접 migration을 적용하지 않고 저장소 migration과 로컬 검증부터 수행한다.
- 각 Phase는 `docs/MEDIA_THREAD_ENRICHMENT_PROMPTS.md`의 해당 프롬프트로 별도 실행한다.
