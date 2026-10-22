# Bookmark Content Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 소량 자동 점검과 수동 일괄 검사로 북마크의 접속·본문·미디어 상태를 구분하고, 근거를 보고 사용자가 직접 정리하게 한다.

**Architecture:** 기존 owner tRPC·Postgres 작업·인증된 worker를 확장한다. 일반 URL의 제한된 문서/미디어 관측을 기본으로 하고 애매한 근거만 기존 OpenRouter Jev로 분류한다. 모든 결과를 동일한 증거 계약으로 저장하며 사용자 정리와 비용 정산을 분리한다.

**Tech Stack:** Node 24, pnpm 10.33.0, Next.js 16.4.2, React, tRPC/Zod, Cheerio, Supabase/Postgres/pg_cron/pg_net, 기존 OpenRouter System One, Vitest/pgTAP.

**Spec:** [북마크 본문·미디어 상태 점검 상세 설계](../specs/2026-10-22-bookmark-content-health-design.md).

문서 상태: 2026-10-22 기준 **실행 전 검토본**. 사용자는 방향성과 문서 작성을 승인했으며 구현을 금지했다. 아래 checkbox는 모두 미래 작업이고 명령·테스트·commit 예시는 실행하지 않았다. 설계와 계획 검토, 이후 별도 구현 지시 전에는 작업을 시작하지 않는다. 실행 방식도 아직 선택하지 않았다.

## Global Constraints

- Node `24.x`, pnpm `10.33.0`, 기존 Next.js·React·tRPC·Supabase·Cheerio·Zod를 사용하고 새 제품 의존성을 추가하지 않는다.
- `UI → owner tRPC → service → repository → RPC/DB`, 내부 worker 인증, `is_applemint_owner()`와 RLS를 유지한다.
- 기존 `check.status=healthy`는 접속 응답 성공이다. 본문·미디어 정상으로 재해석하거나 과거 검사에 새 정상 판정을 채우지 않는다.
- HTTP·HTTPS, DNS pinning, 실제 연결 IP, 모든 redirect의 내부망 차단을 원문과 미디어에 동일하게 적용한다.
- 검사 도중 DB transaction·행 잠금을 외부 네트워크 요청까지 유지하지 않는다. 작업·호스트 점유는 만료 가능한 DB lease다.
- 기존 KST 달력 월 `$1` 공유 AI 한도와 nano-dollar 정산을 유지한다. 비용 불명확 요청은 자동 재호출하지 않는다.
- 자동 삭제·자동 휴지통 이동·자동 숨김·전체 원문 아카이브·전체 영상 다운로드·로그인 우회·범용 브라우저 실행 환경은 포함하지 않는다.
- 이번 작업은 문서 작성만 수행한다. 제품 코드·migration 생성/적용·실제 검사·유료 모델 호출·commit·push·배포는 실행하지 않는다.

마지막 줄의 금지는 현재 문서 작성 단계에 적용한다. 이후 명시적 구현 지시를 받으면 승인 범위 안에서 계획을 실행하고, 공유 DB reset·무관한 변경·승인 없는 운영 적용은 계속 금지한다. 원격 기본 브랜치/현재 작업 상태를 다시 확인해 작업을 격리한다. 이 문서의 기준 HEAD는 `fefac202573d37cc4bd00ce08b97a7b273be0d10`이다.

## Review Focus

1. 로그인·봇 차단·JS shell·인용된 삭제 문장: 삭제나 본문 정상으로 과신하지 않는다. Task 2의 `quoted removal notice is not a deletion screen` / `JS shell remains unknown` 테스트에 고정한다.
2. signed URL·lazy media·일부만 읽힌 긴 페이지: 정확한 query와 범위를 보존하고 일부 확인을 전체 정상으로 만들지 않는다. Task 2의 `signed lazy media preserves its query and coverage`에 고정한다.
3. 자동·수동 동시 시작과 KST 자정/09시·예산 경계: 중복 요청과 다른 작업의 정지를 막는다. Tasks 4/5의 동시 session·budget-wait 테스트에 고정한다.
4. 응답 유실·stale lease·북마크 변경 후 늦은 AI 비용: 알려진 비용을 보존하고 판정은 현재 항목을 덮어쓰지 않는다. Task 4의 `late receipt settles without applying stale evidence`에 고정한다.
5. 상세를 연 뒤 새 근거가 도착한 상태에서 유지/일괄 유지: 보지 않은 결과를 검토 완료로 지우지 않는다. Tasks 1/6의 evidenceId/evidenceRevision 충돌 테스트에 고정한다.

---

## 실행 순서와 파일 구조

한 기능의 계약·수집·판정·실행·자동 등록·UI로 이어지는 의존 작업이며 독립 제품으로 분해하지 않는다. Task 1 → 2 → 3 → 4 → 5 → 6 순서로 실행한다. 앞 작업의 독립 테스트 통과는 기능 완성/배포 승인이 아니다. 실제 사용자 흐름은 Task 6까지 연결된 다음 검증한다.

| 생성/변경 대상 | 책임 | 작업 |
| --- | --- | --- |
| 새 `contracts/bookmark-health.schema.ts` | 공개 evidence·Settings·시작 결과와 입력 schema | 1 |
| 변경 `contracts/bookmark.schema.ts` | nullable evidence·reviewType·Settings 확장 | 1 |
| 새 CLI migration `bookmark_content_health_contract` | 결과·checkpoint·AI key 열과 조회/검토 보호 | 1 |
| 변경 `types/database.types.ts` | CLI 생성 타입; 직접 편집 금지 | 1/4/5 |
| 변경 `server/bookmarks/safe-fetch.ts`, `health.ts` | 안전한 bytes 수집·기존 접속 분류·본문 관측 진입 | 2 |
| 새 `server/bookmarks/health-content.ts`, `health-media.ts` | 범용 본문 추출·제한된 미디어 확인 | 2 |
| 새 `server/bookmarks/health-decision.ts` | 전용 Jev 질문·응답·근거 key·예약 상한 | 3 |
| 새 `server/bookmarks/health-worker.ts` | check 단계·lease admission·AI 예약/정산 연결 | 4 |
| 변경 `server/bookmarks/worker.ts` | check claim schema·전용 처리 위임 | 4 |
| 새 CLI migration `bookmark_content_health_worker` | host lease·AI 원자적 예약/정산·check commit/복구 | 4 |
| 새 CLI migration `bookmark_content_health_schedule` | 일일 등록·중복·우선순위·Settings·payload 정리 | 5 |
| 변경 `server/repositories/bookmark.repository.ts`, `server/services/bookmark.service.ts`, `server/trpc/routers/bookmark.router.ts` | owner API와 명시적 시작 응답 | 5 |
| 새 `lib/bookmark-health.ts` | 공개 상태를 화면 badge/설명으로 변환 | 6 |
| 변경 bookmark library/row/detail/jobs/actions·`lib/bookmark-list.ts` | 필터·상태·진행·명시적 evidenceId·갱신 | 6 |
| 새 `app/main/setting/bookmarks/bookmark-health-settings.tsx`, 변경 같은 폴더 `page.tsx` | 자동 점검 설정·상태 | 6 |
| 변경 `docs/BOOKMARK_IMPLEMENTATION.md`, 새 `docs/reports/2026-10-22-bookmark-content-health-verification.md` | 최종 동작과 실제 검증 결과/한계 | 6 |

테스트 파일은 아래 각 task의 Files에 지정한다. 신규 migration은 해당 task 실행 때 `supabase migration new <정확한 suffix>`로 생성한다. 이 표의 suffix는 확정 이름이며 숫자 timestamp는 CLI 발급값이다. 경로를 미리 꾸며 만들지 않고 생성된 정확한 경로를 task ledger와 commit에 기록한다. CLI 사용 전 `supabase --help`, `supabase migration new --help`, DB 변경 전 해당 명령 `--help`로 설치 버전을 확인한다.

## Task 1: 증거 계약·저장·서버 필터

**Files:**
- Create: `contracts/bookmark-health.schema.ts`, `contracts/bookmark-health.schema.test.ts`.
- Modify: `contracts/bookmark.schema.ts`, `contracts/bookmark-manager.test.ts`, `types/database.types.ts`.
- Create at execution: CLI migration suffix `bookmark_content_health_contract`.
- Test: 새 `supabase/tests/bookmark-content-health.test.sql`, 기존 `supabase/tests/bookmark-manager.test.sql`.

**Interfaces:**
- Consumes: 기존 `BookmarkItem`, `LinkResult`의 접속 의미, `bookmark_checks`·`bookmark_snapshot`·keep/bulk 명령.
- Produces in `bookmark-health.schema.ts`: `bookmarkHealthEvidenceSchema`/`BookmarkHealthEvidence`(spec §4), `bookmarkHealthSettingsInputSchema`(enabled/dailyLimit).
- Produces in `bookmark.schema.ts`, after `bookmarkJobSchema`: `bookmarkHealthSettingsSchema`/`BookmarkHealthSettings`, `bookmarkHealthStartResultSchema`/`BookmarkHealthStartResult`(spec §8/9). 이 응답의 job은 기존 BookmarkJob schema를 직접 참조하며 역방향 import/순환 참조를 만들지 않는다.
- Produces: 기존 check에 `checked_url:string|null`, `evidence:BookmarkHealthEvidence|null`(누락 시 null default), `evidence_revision:number`(누락 시 1). `bookmarkVersionInputSchema`에 `evidenceRevision`을 positive integer optional로 추가한다. 기존 Settings에 `health_auto_enabled:boolean`, `health_daily_limit:number`; 이전 mock Settings의 누락은 false/500 default로 읽는다.
- Produces: `reviewType=all|dead|unused|classify|content|media|uncheckable`과 같은 서버 count/page 의미. 새 필드가 없는 기존 결과를 content.present로 만들지 않는다.

- [ ] **Step 1: Write the failing contract tests.** `legacy HTTP success has no content evidence`, `limited media never becomes fully healthy`, `health settings enforce 1 through 1000`를 추가한다.

  ```ts
  expect(bookmarkHealthSettingsInputSchema.safeParse({ enabled: true, dailyLimit: 0 }).success).toBe(false);
  expect(bookmarkHealthSettingsInputSchema.safeParse({ enabled: true, dailyLimit: 1001 }).success).toBe(false);
  expect(bookmarkListInputSchema.parse({ review: true, reviewType: "media" }).reviewType).toBe("media");
  // 기존 check fixture에 두 신규 필드를 생략한 결과를 파싱한다.
  expect(parsedLegacy.check.evidence).toBeNull();
  expect(parsedLegacy.check.status).toBe("healthy");
  ```

- [ ] **Step 2: Run RED.** `pnpm.cmd exec vitest run contracts/bookmark-health.schema.test.ts contracts/bookmark-manager.test.ts`. Expected: 신규 schema/필터 부재로 FAIL; 기존 HTTP 의미는 실패 원인이 아님을 확인한다.
- [ ] **Step 3: Write failing SQL cases.** 새 pgTAP에 healthy+deleted_suspected, healthy+partial media, restricted, legacy null, direct media의 applicable=false, stale version, reviewed check를 넣고 content/media/uncheckable의 서버 total과 page ID를 검증한다. modal 이후 새 검사 ID 또는 같은 ID의 evidence_revision이 갱신된 뒤 옛 ID/revision으로 keep하면 `PT409`이며 새 근거가 미검토 상태로 남아야 한다. 다른 북마크의 evidenceId·비소유자·anon도 거절한다. `pnpm.cmd test:db`로 새 기능이 없어서 FAIL함을 확인한다.
- [ ] **Step 4: Add the contract and additive migration.** `supabase migration new bookmark_content_health_contract`의 생성 파일에 spec §7.1의 nullable 열·byte CHECK·AI key 고유 제약·Settings 기본값을 정의한다. 보관되는 미디어 집계에는 `excludedCount/duplicateCount/omittedCount`도 포함하고 `checked=reachable+missing+restricted+unknown`을 검증한다. `bookmark_snapshot`/`bookmark_row`와 기존 review helper들의 동일 판정식을 갱신한다. 조회는 최신 시각/ID tie-break·현재 URL/버전·reviewed_at을 함께 사용한다.
- [ ] **Step 5: Make keep evidence-specific.** 새 health 근거가 있는 keep/bulk keep은 해당 bookmark의 최신 유효 evidenceId/evidenceRevision을 요구하고, 그 근거만 reviewed로 바꾼다. modal 이후 새 검사 또는 같은 행의 갱신은 충돌로 돌려보낸다. 기존 null evidence의 keep·unused review 제외·classify 제안 보존은 유지한다. 자동 검사 commit은 bookmark 필드를 수정하지 않는다.
- [ ] **Step 6: Generate and verify.** `pnpm.cmd db:types:generate`, Step 2의 Vitest, `pnpm.cmd test:db`를 실행한다. Expected: schema/SQL PASS, 과거 영수증·과거 check·가져오기 원본 손실 0. 공유 DB는 reset하지 않는다.
- [ ] **Step 7: Commit scoped contract changes.** `git add --` 뒤 위 Files의 실제 파일과 CLI 발급 migration 경로만 명시하고 `git commit -m "feat(bookmarks): define content health evidence"`를 실행한다. staged diff가 해당 범위뿐인지 먼저 확인한다.

## Task 2: 안전한 본문·미디어 관측

**Files:**
- Modify: `server/bookmarks/safe-fetch.ts`, `server/bookmarks/health.ts`, 기존 두 파일의 테스트 및 `server/bookmarks/health-classification.test.ts`.
- Create: `server/bookmarks/health-content.ts`, `server/bookmarks/health-content.test.ts`, `server/bookmarks/health-media.ts`, `server/bookmarks/health-media.test.ts`.
- Regression: `server/bookmarks/worker.test.ts`, `app/api/media/youtube/videos-list.test.ts`; 기존 YouTube adapter의 공개 함수/타입을 재사용한다.

**Interfaces:**
- Consumes: Task 1 `BookmarkHealthEvidence`; 기존 `safeFetch`, `normalizeYouTubeUrl`, `listYouTubeVideos`.
- Produces in `health.ts`: `inspectBookmarkPage(input: HealthInput, io: HealthIO): Promise<HealthObservation>`와 기존 `checkBookmarkLink(url:string):Promise<LinkResult>`의 접속 계약. 주 worker는 inspect를 사용하며 접속과 본문을 두 번 fetch하지 않는다.
- `HealthInput={bookmarkId:string,url:string,version:number,baseline:HealthBaseline|null,decisionSample:boolean}`.
- `HealthBaseline={checkId:string,url:string,observedAt:string,title:string,textHash:string,textLength:number,mediaReachable:number}`; 정상·동일 URL의 과거 근거만 전달한다.
- `HealthIO={signal:AbortSignal,beforeRequest:(url:URL)=>Promise<(retryAt?:string)=>Promise<void>>}`; 반환 함수는 host permit 해제이며 finally에서 실행한다. 429/503의 유효 Retry-After(최대 24시간) 또는 기본 15분을 해제 함수에 전달하고 다른 종료에는 생략한다.
- Produces in `health-content.ts`: `extractHealthContent(input:{body:string,finalUrl:string,truncated:boolean}): HealthContentObservation`. 결과는 evidence.content, coverage, `HealthMediaReference[]`, 제외/중복/누락 집계다. `HealthMediaReference={kind:'image'|'video'|'embed',url:string,sourceUrl:string,label:string,urlHash:string}`; sourceUrl은 query/fragment를 제거한 최종 원문 URL이다.
- `HealthObservation={input:HealthInput,reachability:LinkResult,evidence:BookmarkHealthEvidence,mediaRefs:HealthMediaReference[]}`.
- Produces in `health-media.ts`: `probeHealthMedia(ref:HealthMediaReference,io:HealthIO):Promise<BookmarkHealthEvidence['media']['items'][number]>`.
- `safeFetch` 기존 결과와 `body:string`을 유지하고 `bodyBytes:Uint8Array,truncated:boolean,retryAfter:string|null,contentEncoding:string|null`를 추가한다. 옵션은 기존 `maxBytes`와 `signal?`, `beforeRequest?`, `referrer?:string`이다. referrer는 credential 없는 HTTP(S) sourceUrl의 origin/path만 허용한다. media probe만 이를 전달하고 임의 cookie/header 전달 옵션을 만들지 않는다.

- [ ] **Step 1: Write failing extraction cases.** 이름은 `quoted removal notice is not a deletion screen`, `JS shell remains unknown`, `signed lazy media preserves its query and coverage`, `zero media without baseline is none_detected`, `direct media bypasses HTML extraction`로 한다. 실제 외부 자료와 연결되지 않는 fixture는 결정론적 분기 재현에만 쓴다.

  ```ts
  expect(extracted.mediaRefs[0].url).toBe("https://cdn.example.com/a.jpg?token=keep-this");
  expect(overLimit.evidence.coverage).toBe("limited");
  expect(noBaseline.evidence.media.status).toBe("none_detected");
  expect(jsShell.evidence.content.status).toBe("unknown");
  expect(quotedRemoval.evidence.content.status).not.toBe("deleted_suspected");
  ```

- [ ] **Step 2: Write failing network/media cases.** 200 HTML을 반환한 jpg, 403·429, private redirect/DNS rebinding, 524288-byte body 경계, 압축 후 한도 초과, EUC-KR, 기존 parent AbortSignal, 응답 stream 실패, 해제 함수 호출을 검증한다. permit 대기는 `safe-fetch.ts`에 export하는 `HealthRequestDeferred extends Error`의 `constructor(public readonly retryAt:string)`로 구별한다. 다음 available_at으로 넘기고 실제 sleep하지 않는다. 내부 URL에 실제 socket을 열지 않는 기존 테스트를 유지한다.
- [ ] **Step 3: Run RED.** `pnpm.cmd exec vitest run server/bookmarks/safe-fetch.test.ts server/bookmarks/health-content.test.ts server/bookmarks/health-media.test.ts server/bookmarks/health-classification.test.ts`. Expected: 신규 interface/관측 분기 부재로 FAIL.
- [ ] **Step 4: Extend bounded fetch.** `safe-fetch.ts`의 DNS pin·actual IP·redirect 검증 뒤 요청 permit을 획득하고 finally에서 해제한다. 표준 Node stream/zlib/TextDecoder로 wire/decoded 상한을 각각 지킨다. 기존 body 반환과 실패 code를 보존한다. permit 대기를 일반 NETWORK 실패로 바꾸지 않는다.
- [ ] **Step 5: Implement page extraction and probes.** 위 exact signature에 spec §4/5의 524288/65536 bytes·20개 media 한도·charset/압축·부분 범위 규칙을 구현한다. 이미지/영상 signature와 MIME은 응답 확인 용도다. YouTube 누락을 삭제로 확정하지 않으며 iframe 성공을 재생 성공으로 만들지 않는다. 정상 body의 인용 문장만으로 삭제를 결정하지 않는다.
- [ ] **Step 6: Run GREEN and caller regression.** Step 3 명령과 `pnpm.cmd exec vitest run server/bookmarks/worker.test.ts server/bookmarks/health.test.ts app/api/media/youtube/videos-list.test.ts`를 실행한다. 실제 네트워크 opt-in 테스트를 자동 활성화하지 않는다. Expected: deterministic PASS, 기존 metadata/body consumer 변경 누락 없음.
- [ ] **Step 7: Commit scoped collector changes.** 위 Files 중 변경한 경로만 명시적으로 stage하고 `git commit -m "feat(bookmarks): inspect bounded page and media evidence"`.

## Task 3: Jev 질문과 검증·비용 반환

**Files:**
- Create: `server/bookmarks/health-decision.ts`, `server/bookmarks/health-decision.test.ts`.
- Regression: 기존 `server/bookmarks/openrouter.test.ts`, `server/bookmarks/recommendation.test.ts`.

**Interfaces:**
- Consumes: Task 2 `HealthObservation`, 기존 `openrouter('systemone',request)`와 `openrouterCost`.
- Produces: `buildHealthDecisionRequest(observation:HealthObservation): HealthDecisionRequest`, `healthDecisionReservation():{tokens:number,nano:number}`, `healthEvidenceKey(observation:HealthObservation):string`, `callHealthDecision(request:HealthDecisionRequest):Promise<HealthDecisionOutcome>`.
- `HealthDecisionRequest`는 spec §6의 model/provider/state/questions이며 JSON 12000-byte gate를 통과해야 한다. `questionRevision=1`을 key에 포함한다.
- `HealthDecisionOutcome={choice:'present'|'deleted'|'restricted'|'unrelated'|'unknown'|null,basis:'deletion_notice'|'auth_notice'|'content_match'|'content_mismatch'|'insufficient'|null,confidence:number|null,chargedNano:number|null,inputTokens:number|null,outputTokens:number|null,outputError:string|null}`. 응답 오류여도 읽을 수 있는 charge를 먼저 반환한다. 이 모듈은 DB 쓰기/삭제/예산 우회를 하지 않는다.

- [ ] **Step 1: Write failing Choice/cost tests.** out-of-set·확률 합/rank·pinned model·잘못된 usage·cost 누락, confidence 미달·근거 모순·input 길이·query/메모 비전송을 검증한다.

  ```ts
  expect(healthDecisionReservation()).toEqual({ tokens: 65536, nano: 2752512 });
  expect(JSON.stringify(request)).not.toContain("token=keep-this");
  expect(request.questions.pageState.criteria).toHaveProperty("unknown");
  expect(lowConfidence.choice).toBe("unknown");
  expect(invalidOutputWithKnownCost.chargedNano).toBe(42000);
  expect(invalidOutputWithKnownCost.outputError).not.toBeNull();
  ```

- [ ] **Step 2: Run RED.** `pnpm.cmd exec vitest run server/bookmarks/health-decision.test.ts`. Expected: 신규 exports 부재로 FAIL. 공급자 실제 호출은 하지 않는다.
- [ ] **Step 3: Implement exact interfaces.** 기존 OpenRouter client를 사용해 spec §6의 2개 Choice와 0.90 threshold를 구현한다. confidence는 정답률로 출력하지 않는다. 알려진 비용의 nano 올림·비정상 금액 거절은 `openrouterCost`를 재사용한다. scalar/text 전용 state를 사용하며 이미지 전수 판정·모델 upgrade·새 SDK를 넣지 않는다.
- [ ] **Step 4: Run GREEN and recommendation regression.** Step 2 명령과 `pnpm.cmd exec vitest run server/bookmarks/openrouter.test.ts server/bookmarks/recommendation.test.ts`. Expected: 모든 선택 테스트 PASS, 기존 collection 추천의 모델/요청/영수증 의미 유지.
- [ ] **Step 5: Commit scoped decision changes.** 새 두 파일만 stage하고 `git commit -m "feat(bookmarks): classify ambiguous health evidence with Jev"`.

## Task 4: 재개 가능한 worker와 항목별 비용·호스트 lease

**Files:**
- Create: `server/bookmarks/health-worker.ts`, `server/bookmarks/health-worker.test.ts`.
- Modify: `server/bookmarks/worker.ts`, `server/bookmarks/worker.test.ts`, `types/database.types.ts`.
- Create at execution: CLI migration suffix `bookmark_content_health_worker`.
- Test: 새 `supabase/tests/bookmark-health-worker.test.sql`, `supabase/tests/bookmark-health-worker-concurrency.test.sql`; 기존 `supabase/tests/bookmark-request-identity.test.sql`, `bookmark-openrouter-budget.test.sql`.

**Interfaces:**
- Consumes: Tasks 1–3의 계약/관측/Jev 함수와 기존 `bookmark_worker_claim/commit`.
- Produces in `health-worker.ts`: `processHealthClaim(db:AppSupabaseClient,claim:HealthClaim):Promise<HealthCommit>`.
- `HealthClaim={job:BookmarkJob,item:BookmarkItem&{expected_version:number,work:HealthWork|null},baseline:HealthBaseline|null}`.
- `HealthWork={phase:'page'|'media'|'decision'|'confirm'|'done',observation:HealthObservation|null,mediaCursor:number,reservationId:string|null,evidenceKey:string|null,confirmAfter:string|null,confirmationFingerprint:string|null,confirmationFirstObservedAt:string|null,confirmationAttempts:0|1}`; 전체 work 65536 bytes 이하. null work는 page에서 시작한다.
- `HealthCommit={items:Array<{id:string,version:number,state:'pending'|'waiting'|'done'|'failed',work:HealthWork|null,check?:LinkResult&{checkedUrl:string,evidence:BookmarkHealthEvidence},availableAt?:string,error?:string}>,progress?:Record<string,unknown>}`. 기존 `bookmark_worker_commit` envelope에 병합하며 schema/SQL도 같은 camelCase key를 사용한다.
- 신규 worker RPC: `bookmark_health_host_claim(p_host text) → {token:uuid|null,retryAt:timestamptz}`, `bookmark_health_host_release(p_host text,p_token uuid,p_retry_at timestamptz) → boolean`.
- 신규 AI RPC: `bookmark_health_ai_reserve(p_job uuid,p_lease uuid,p_bookmark uuid,p_reservation uuid,p_evidence_key text) → jsonb`, `bookmark_health_ai_settle(p_reservation uuid,p_result jsonb) → boolean`. reserve 응답은 `{state:'reserved'|'cached'|'uncertain'|'budget_wait'|'output_failed',reservationId:string|null,decision:{choice,basis,confidence}|null,retryAt:string|null}`이며 기존 7인자 예산 RPC를 호출하고 연결을 원자적으로 보존한다. 캐시 결과는 ledger의 nullable `health_decision`에서 읽으며 cached일 때만 재사용한다. settle의 p_result는 `{state:'settled'|'uncertain',chargedNano:number|null,inputTokens:number|null,outputTokens:number|null,outputError:string|null,decision:{choice,basis,confidence}|null}`이다. 알려진 charge/uncertain 전환만 멱등 적용하고 결과 게시 권한을 부여하지 않는다. charge가 예약액을 초과해도 실제 비용을 버리지 않으며 기존 초과 예산 차단 규칙을 유지한다.

- [ ] **Step 1: Write failing phase/recovery tests.** 2개 media 이후 cursor 보존·프로세스 재시작·permit 대기·24시간 content 재확인·기존 HTTP 1분 재확인·제한 응답 회복을 검사한다. media/AI claim 중 원문을 반복 수집하지 않는지도 확인한다.
- [ ] **Step 2: Write failing billing/independence tests.** `late receipt settles without applying stale evidence`, `budget wait does not block the next page item`, `uncertain health request fails only its item`, `same evidence reuses a settled result`를 추가한다. 다음 항목 관측은 계속하고, ambiguous 비용 요청은 전역 fetch spy 호출 1회여야 한다.

  ```ts
  expect(twoMediaStep.items[0].work.mediaCursor).toBe(2);
  expect(budgetWait.items[0].state).toBe("waiting");
  expect(uncertain.items[0].state).toBe("failed");
  expect(nextIndependentClaimWasProcessed).toBe(true);
  expect(lateReceiptWasSettled).toBe(true);
  expect(staleCheckWasApplied).toBe(false);
  ```

- [ ] **Step 3: Run RED.** `pnpm.cmd exec vitest run server/bookmarks/health-worker.test.ts server/bookmarks/worker.test.ts`. Expected: 신규 phase/worker delegation 부재로 FAIL. 새 SQL에는 동일 host 두 session 경쟁, 15초 lease 회복, token 불일치 해제 거절, evidence key 중복 예약, 월 $1 경계, known-cost invalid 출력, stale bookmark/휴지통/lease commit을 넣고 `pnpm.cmd test:db` FAIL을 확인한다.
- [ ] **Step 4: Add worker RPC/migration.** `supabase migration new bookmark_content_health_worker`로 host private table와 위 RPC를 만든다. 실행 grant는 service_role에만 주고 transaction 안에서 external request를 하지 않는다. claim에는 baseline/work를 반환하고 check의 예약 유실을 항목 단위로 복구한다. 이미 처리 중인 구형 check는 pause하고 새 방식 재개 사유를 기록한다. 기존 import/recommend/분류/정산 분기는 삭제하지 않는다.
- [ ] **Step 5: Implement phase orchestration.** 위 `processHealthClaim`을 구현하고 `worker.ts`의 check 분기를 위임한다. media claim은 2개 이하, 상위 signal은 phase의 새 요청 시작을 20초 내로 제한한다. AI claim은 25초 client timeout 뒤 DB commit 여유를 두고 그 invocation을 종료한다. route maxDuration=60, job lease=90초를 늘려 해결하지 않는다.
- [ ] **Step 6: Preserve provisional readback and finish semantics.** page/media/decision/confirm의 잠정 evidence도 동일 check 행에 upsert하고 evidence_revision을 증가시키되 실제 observedAt을 유지한다. confirm은 원문/미디어를 새로 확인하고 최대 1회로 제한하며 불일치는 unknown으로 끝낸다. firstObservedAt/confirmedAt 간격이 HTTP는 60초, 본문/미디어는 86400초 이상임을 테스트/DB로 검증한다. budget 대기는 다음 KST 월 경계, confirm은 정해진 간격, permit은 retryAt을 사용한다. done/failed/대기 수로 spec §7의 job 상태를 계산하고, AI 미설정과 unsupported source는 unknown 완료로 표시한다. AI 불명확의 일반 resume은 재요청을 금지하며 이미 정산된 결과만 재사용한다.
- [ ] **Step 7: Verify GREEN and generated types.** `pnpm.cmd db:types:generate`, Step 3 명령, `pnpm.cmd test:db`, `pnpm.cmd exec vitest run app/api/bookmarks/worker/route.test.ts server/bookmarks/recommendation.test.ts`를 실행한다. Expected: PASS, 기존 내부 인증/금액/RLS 저하 없음.
- [ ] **Step 8: Commit scoped worker changes.** 위 Files와 CLI 발급 migration을 명시적으로 stage하고 `git commit -m "feat(bookmarks): persist health stages and guarded AI receipts"`.

## Task 5: 일일 선정·수동 중복·Settings API

**Files:**
- Create at execution: CLI migration suffix `bookmark_content_health_schedule`.
- Modify: `server/repositories/bookmark.repository.ts`, `server/services/bookmark.service.ts`, `server/trpc/routers/bookmark.router.ts`, 각 기존 테스트, `types/database.types.ts`.
- Test: 새 `supabase/tests/bookmark-health-schedule.test.sql`, `supabase/tests/bookmark-health-schedule-concurrency.test.sql`.

**Interfaces:**
- Consumes: Task 1 Settings/StartResult, Task 4 stage와 due work.
- Produces owner API: `bookmarkCheck.settings.query():BookmarkHealthSettings`, `bookmarkCheck.updateSettings.mutate({enabled:boolean,dailyLimit:number}):BookmarkHealthSettings`, `bookmarkCheck.start(BookmarkScope):BookmarkHealthStartResult`.
- Repository: `healthSettings():Promise<BookmarkHealthSettings>`, `updateHealthSettings(input:{enabled:boolean,dailyLimit:number}):Promise<BookmarkHealthSettings>`, `startHealth(scope:BookmarkScope):Promise<BookmarkHealthStartResult>`; service는 같은 이름/반환을 위임한다. 기존 `start`의 import/AI 작업 반환은 바꾸지 않는다. bookmarkCheck.start의 caller만 startHealth로 바꾼다.
- Owner DB: `bookmark_health_settings() → jsonb`, `bookmark_health_update_settings(p_enabled boolean,p_daily_limit integer) → jsonb`; manual start는 기존 `bookmark_command('start',...)`의 check 분기만 start-result envelope를 반환한다.
- Internal DB: `enqueue_bookmark_health_daily() → uuid|null`, `private.bookmark_health_due(p_now timestamptz,p_limit integer) → table(bookmark_id uuid,decision_sample boolean)`; private 함수의 p_now는 결정론적 SQL 테스트용이며 외부에서 clock override를 받지 않는다. daily 함수는 `now()`만 사용한다.
- 일일 job scope: `{origin:'automatic',automaticDate:'YYYY-MM-DD',scope:'selected',ids:string[]}`; manual은 기존 scope에 `{origin:'manual'}`을 서버가 붙인다. origin은 클라이언트 입력으로 신뢰하지 않는다.

- [ ] **Step 1: Write failing owner API tests.** 비소유자/anon 거절, 0/1001 거절, Settings false/500 default, token 비노출, 모든 항목이 진행 중일 때 job=null/queuedCount=0/reusedCount=requestedCount를 검증한다. 기존 `bookmarkCheck.start` 테스트 반환을 새 envelope로 갱신하고 다른 start API 회귀를 유지한다.
- [ ] **Step 2: Run RED.** `pnpm.cmd exec vitest run server/trpc/routers/bookmark.router.test.ts server/services/bookmark.service.test.ts server/repositories/bookmark.repository.test.ts`. Expected: 신규 owner method/응답 부재로 FAIL.
- [ ] **Step 3: Write failing SQL selection/concurrency cases.** KST 08:59/09:00/23:59/익일, 같은 날짜 2회 dispatch, 빈 라이브러리, 500개 cap, 50개 sample/100개 재검사 quota와 부족분 보충, 90/7/30일 및 24시간 재확인, 한 도메인 집중·미점검 aging을 검증한다. dblink 패턴으로 automatic/manual 동시 시작의 중복 0, all-reused 때 가짜 job 0, 미래 AI 대기만 있으면 새 날짜 원문 등록 가능, 저장 추천이 자동 job보다 먼저 claim되는 것을 고정한다. `pnpm.cmd test:db` RED를 확인한다.
- [ ] **Step 4: Implement schedule/queue migration.** `supabase migration new bookmark_content_health_schedule`의 생성 파일에서 spec §8의 atomic daily lock·date unique index·후보 선정·backlog 구분·우선순위를 구현한다. `dispatch_bookmark_worker()`에 daily 등록을 연결하되 기존 cron을 추가/복제하지 않는다. Settings disable은 automatic의 새 claim/등록만 중단하고 in-flight 정산을 막지 않는다. readback의 lastAutomaticJob과 worker/Vault 설정 누락 상태를 포함한다.
- [ ] **Step 5: Implement owner methods and payload retention.** 위 정확한 service/repository/router method를 연결하고 새 route를 만들지 않는다. 종료 30일 초과 payload는 최신/정상 baseline/event 참조를 제외해 일일 최대 500행만 clear한다. status·reason·영수증·원본 데이터는 삭제하지 않는다. stage/SQL 보안 definer는 기존 owner·service boundary를 그대로 사용한다.
- [ ] **Step 6: Verify GREEN.** `pnpm.cmd db:types:generate`, Step 2 명령, `pnpm.cmd test:db`. Expected: PASS, 원문 조회 backlog와 AI budget 대기가 분리되고 분류·저장 추천은 정상 실행 가능. migration 후 자동 설정은 false/500이며 실제 활성화는 UI에서 한다.
- [ ] **Step 7: Commit scoped scheduling changes.** 위 Files/생성 migration만 stage하고 `git commit -m "feat(bookmarks): schedule bounded daily health checks"`.

## Task 6: 실제 진입점·상태·필터·직접 정리와 최종 검증

**Files:**
- Create: `lib/bookmark-health.ts`, `lib/bookmark-health.test.ts`, `app/main/setting/bookmarks/bookmark-health-settings.tsx`, `app/main/setting/bookmarks/bookmark-health-settings.test.tsx`.
- Modify: `app/main/bookmarks/bookmark-library.tsx`, `bookmark-row.tsx`, `bookmark-item-dialog.tsx`, `bookmark-jobs.tsx`, `use-bookmark-actions.ts`, 각 기존 테스트, `lib/bookmark-list.ts`, `lib/bookmark-list.test.ts`, `app/main/setting/bookmarks/page.tsx`.
- Modify: `server/repositories/bookmark.repository.ts`/테스트의 jobDetails 응답에 phase·실제 available_at·AI 대기 사유; 기존 state enum은 유지.
- Modify: `docs/BOOKMARK_IMPLEMENTATION.md`; Create: `docs/reports/2026-10-22-bookmark-content-health-verification.md`.

**Interfaces:**
- Consumes: Tasks 1/5의 `BookmarkItem`·Settings·StartResult·추가 reviewType·Task 4 작업/phase 집계.
- Produces: `healthSummary(item:BookmarkItem):{label:string,detail:string,severity:'neutral'|'warning'|'danger'}|null` in `lib/bookmark-health.ts`; stale/reviewed 근거의 후보 badge는 반환하지 않는다.
- Produces: `BookmarkHealthSettingsPanel()` in 새 설정 파일; 기존 Setting 페이지에 삽입한다.
- `jobDetails` item에 `phase:'page'|'media'|'decision'|'confirm'|'done'|null`과 `waitingReason:'host'|'ai_budget'|'confirmation'|'retry'|null`을 추가한다. raw work/media URL·lease token을 클라이언트로 반환하지 않는다.
- 기존 row/detail/bulk의 keep은 실제 본 check의 `evidenceId/evidenceRevision`을 전달한다. `useBookmarkChange`의 `{id,version}` mapping이 이 두 값을 버리지 않게 수정한다. server는 unseen 새 근거를 PT409로 돌려주므로 UI는 상세 재조회 안내를 한다.

- [ ] **Step 1: Write failing presentation/Settings tests.** `HTTP success never labels content healthy`, `limited media names its checked count`, `legacy evidence says connection only`, `settings default is off with 500 per day`, `disable preserves in-flight results`를 구현한다.

  ```ts
  expect(healthSummary(partialItem)?.label).toBe("미디어 일부 확인 실패");
  expect(healthSummary(staleItem)).toBeNull();
  expect((screen.getByRole("checkbox", { name: "매일 자동 점검" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("spinbutton", { name: "하루 점검 개수" }) as HTMLInputElement).value).toBe("500");
  ```

- [ ] **Step 2: Write failing consumer/race tests.** library에서 content/media/uncheckable URL·filter·선택 초기화·서버 total 연동, start-result 재사용 건수 표시를 검증한다. detail/row/bulk에서 evidenceId/evidenceRevision을 전달하고, 늦은 새 check 또는 같은 check의 갱신 때문에 keep이 PT409일 때 새 결과를 숨기지 않는 것을 고정한다. 작업 기록의 기존 ‘1분 뒤’ 하드코딩을 phase/available_at 표현으로 바꾸는 테스트를 추가한다. retry/processing 도중 새 provisional evidence가 바뀌어도 목록/열린 상세가 갱신되는지 검사한다.
- [ ] **Step 3: Run RED.** `pnpm.cmd exec vitest run lib/bookmark-health.test.ts lib/bookmark-list.test.ts app/main/bookmarks/bookmark-library.test.tsx app/main/bookmarks/bookmark-row.test.tsx app/main/bookmarks/bookmark-item-dialog.test.tsx app/main/bookmarks/use-bookmark-actions.test.tsx app/main/setting/bookmarks/bookmark-health-settings.test.tsx`. Expected: UI/새 입력 부재로 FAIL.
- [ ] **Step 4: Implement UI and polling.** 기존 house Button/Card/입력 스타일과 query cache를 사용한다. spec §9의 필터·badge·검사 범위·재생 미확인·근거·자동/수동 origin·대기 사유·Settings 활성화 안내를 연결한다. `bookmarkResultsChanged`는 terminal 상태뿐 아니라 check 결과 revision/updated_at 변경도 invalidate하게 한다. polling 간격을 무작정 줄여 해결하지 않는다. 사용자 정리 동작은 기존 승인/version/낙관적 복구를 보존한다.
- [ ] **Step 5: Run GREEN and repository preflight.** Step 3 명령, `pnpm.cmd check`, `pnpm.cmd verify`를 실행한다. verify는 기존 격리 DB·타입·coverage·pgTAP·build 경로를 사용한다. Expected: PASS. 이번 변경 뒤 재수정/실패가 없으면 같은 전체 검증을 반복하지 않는다.
- [ ] **Step 6: Verify the real manual entry point.** 현재 실제 서버/브라우저와 owner 로그인으로 적어도 5개 도메인의 실제 북마크 30개를 고른다. UI 선택 → 링크 검사 → 실제 worker → DB evidence/영수증 → 새로고침한 필터/상세를 대조한다. fixture를 끼워 넣어 실제 링크 검증이라고 하지 않는다. 정상/애매한 자료 10개 이상의 실제 Jev 영수증도 비교하며 기존 키·월 $1 한도 안에서 수행한다. 예산이 부족하면 실패·대기와 미검증을 그대로 보고하고 예산을 올리지 않는다.
- [ ] **Step 7: Verify the real automatic entry point.** Settings에서 실제 enabled=true/dailyLimit를 저장하고 owner readback을 확인한 뒤 KST 09시 이후 기존 cron의 다음 dispatch로 생성되는 automaticDate/job/item을 관측한다. 해당 날짜 job이 이미 있거나 시각 전이면 다음 실제 유효 시각까지 이 검증을 미완료로 남긴다. 직접 enqueue/worker SQL·가짜 시계·UI와 무관한 API로 PASS를 대체하지 않는다. 다른 수동 작업·저장 추천의 도달성도 확인한다.
- [ ] **Step 8: Verify human cleanup and report quality.** 실제 후보의 직접 열기·유지·휴지통·복원을 UI에서 수행하고 해당 근거와 원본 보존을 owner DB로 대조한다. 정상/삭제/미디어/제한/JS 각 유형의 실측 여부를 적고, 오탐·의심 후보 적중·unknown·AI 호출률·전송량·시간·artifact/HEAD를 보고서에 기록한다. 적당한 실제 대상이 없는 유형은 미검증으로 남긴다. 30개 표본을 보장 정확도로 표현하지 않는다.
- [ ] **Step 9: Commit scoped UI/evidence changes.** 위 Files 중 실제 변경한 파일과 검증 보고서만 stage한 뒤 `git commit -m "feat(bookmarks): expose health review and automatic check settings"`. 보고서에는 직접 완료한 근거만 PASS로 적고 자동 주 흐름 미관측 시 기능 전체 완료를 선언하지 않는다. push·PR·운영 migration·배포는 이후 승인 범위를 확인한다.

## 자체 검토 결과와 실행 인계

- Spec §1–4/7/9의 공개 계약·저장·필터·근거 확인: Tasks 1/6.
- Spec §5의 일반 문서·direct media·상한·SSRF·인코딩·partial: Task 2.
- Spec §6의 Jev·확신도·입력 최소화·가격: Task 3; 예약/복구/독립 진행은 Task 4.
- Spec §7/8의 단계·호스트 lease·일일 중복·시간·미래 AI 대기·보관 정리: Tasks 4/5.
- Spec §10/11의 구조·기존 caller·마이그레이션·실제 결과/한계: 모든 Files/Tasks 1/4/6.
- Review Focus의 다섯 조건은 위 named tests/SQL/UI 회귀에 각각 배정했다. 공개 evidence·camelCase commit·SQL 반환·Settings/StartResult 이름을 task 사이에 통일했다. 전체 구현 본문을 계획에 복사하지 않았으며 새로운 일반 프레임워크/실행 환경은 추가하지 않는다.

현재는 문서 검토만 요청한다. 실행 방식은 아직 고르지 않았다. 이후 구현을 요청할 때 선택지는 (1) 내가 순서대로 구현하고 마지막에 별도 리뷰하는 Native, (2) task마다 구현자/리뷰어를 분리하는 Subagent-driven이다. 계약·DB·worker의 의존성이 높고 기존 코드를 함께 보아야 하므로 이 계획은 Native를 권한다. 어느 방식을 선택하든 계획 검토와 명시적 구현 지시가 먼저다. 이 문서를 저장했다는 이유로 agent를 실행하지 않는다.
