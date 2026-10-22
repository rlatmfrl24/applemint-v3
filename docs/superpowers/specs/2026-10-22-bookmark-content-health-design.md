# 북마크 본문·미디어 상태 점검 상세 설계

작성일: 2026-10-22 KST. 기준 소스: `fefac202573d37cc4bd00ce08b97a7b273be0d10`.

상태: 방향성 승인 후 작성한 **문서 검토본**. 사용자는 매일 소량 자동 점검, 수동 일괄 검사, 상태 표시·필터 후 직접 정리를 승인했다. 아래 수치와 세부 계약은 이번 설계의 제안값이며 아직 승인·구현·실측되지 않았다. 연결된 [구현 계획](../plans/2026-10-22-bookmark-content-health.md) 역시 실행 승인을 뜻하지 않는다.

## 1. 목적과 완료 조건

오래된 북마크에서 주소 소멸뿐 아니라 HTTP 200 삭제 안내, 본문 대체, 이미지 연결 실패와 동영상 확인 불가를 발견한다. 검사는 북마크를 이동·삭제하거나 제목·메모·태그·컬렉션·열기 이력을 수정하지 않는다. 사용자는 기존 검토 화면에서 근거를 확인하고 열기·유지·휴지통·복원을 직접 수행한다.

제품의 주 흐름은 다음 두 가지다.

- 자동: Settings의 북마크 설정에서 활성화 → 기존 분 단위 DB dispatch가 당일 대상 선정 → 기존 인증된 worker → 원문·미디어 검사와 필요한 Jev 판정 → 검사 DB → 검토 필터·상세.
- 수동: 북마크의 기존 링크 검사 버튼 → 선택 항목·현재 컬렉션 직접 소속·전체 중 선택 → 같은 작업과 검사기 → 작업 기록·검토 화면 → 사용자 정리.

완료는 두 실제 진입점에서 작업과 결과가 생성되고, 소유자 권한의 DB readback과 새로고침 후 UI가 일치할 때 인정한다. 모의 응답·픽스처·worker 직접 호출만으로 기능을 완료 처리하지 않는다. 구현 중간 커밋은 배포 가능한 제품 완성으로 보지 않는다.

## 2. 공통 제약

- Node `24.x`, pnpm `10.33.0`, 기존 Next.js·React·tRPC·Supabase·Cheerio·Zod를 사용하고 새 제품 의존성을 추가하지 않는다.
- `UI → owner tRPC → service → repository → RPC/DB`, 내부 worker 인증, `is_applemint_owner()`와 RLS를 유지한다.
- 기존 `check.status=healthy`는 접속 응답 성공이다. 본문·미디어 정상으로 재해석하거나 과거 검사에 새 정상 판정을 채우지 않는다.
- HTTP·HTTPS, DNS pinning, 실제 연결 IP, 모든 redirect의 내부망 차단을 원문과 미디어에 동일하게 적용한다.
- 검사 도중 DB transaction·행 잠금을 외부 네트워크 요청까지 유지하지 않는다. 작업·호스트 점유는 만료 가능한 DB lease다.
- 기존 KST 달력 월 `$1` 공유 AI 한도와 nano-dollar 정산을 유지한다. 비용 불명확 요청은 자동 재호출하지 않는다.
- 자동 삭제·자동 휴지통 이동·자동 숨김·전체 원문 아카이브·전체 영상 다운로드·로그인 우회·범용 브라우저 실행 환경은 포함하지 않는다.
- 이번 작업은 문서 작성만 수행한다. 제품 코드·migration 생성/적용·실제 검사·유료 모델 호출·commit·push·배포는 실행하지 않는다.

## 3. 현재 기반과 필요한 변경

| 현재 근거 | 유지할 것 | 추가할 것 |
| --- | --- | --- |
| `server/bookmarks/health.ts` | HTTP/DNS/제한/일시 장애 구분 | 한 번 수집한 문서의 본문·미디어 관측 |
| `safe-fetch.ts` | GET·10초·redirect 5회·SSRF 방어 | 원시 bytes·잘림 표시·상위 abort·제한된 응답 헤더·호스트 lease hook |
| `worker.ts` | claim/commit·90초 lease·재개·60초 route | 작은 단계별 checkpoint·항목별 AI 예약 복구 |
| `bookmark_checks` | 기존 접속 판정·검토 이력 | 검사 URL·버전과 독립된 본문·미디어 증거 |
| `bookmark_snapshot` | 서버에서 필터·전체 건수·페이지 일치 | 본문·미디어·확인 불가 필터와 요약 |
| `dispatch_bookmark_worker()` | 설정/Vault·기존 분 단위 cron | 하루 1회 대상 등록, 빈 작업 생성 방지 |
| 기존 Jev 추천 | OpenRouter System One·비용 장부 | 전용 건강 상태 Choice 질문; 컬렉션 추천 요청은 재사용하지 않음 |

현재 HTTP 404·410·NXDOMAIN 후보는 1분 후 재확인한다. 이 동작을 유지하되, 본문 삭제와 미디어 실패의 재확인은 별도 간격으로 분리한다. `check` 작업은 현재 AI crash 보호 대상이 아니므로 호출 추가만으로 끝내면 안 된다.

## 4. 판정 계약

`contracts/bookmark-health.schema.ts`에 아래 evidence와 Settings 입력 Zod schema를 정의한다. `bookmark.schema.ts`는 이를 참조하고 기존 BookmarkJob schema 뒤에 job을 포함한 Settings/시작 응답 schema를 조립한다. 두 파일의 순환 import는 만들지 않는다.

| 필드 | 값 | 의미 |
| --- | --- | --- |
| 기존 `status` | `healthy / dead / restricted / temporary / uncheckable` | 접속 관측만 표현 |
| `evidence.content.status` | `present / deleted_suspected / changed_suspected / restricted / unknown / not_checked` | 본문 판정 |
| `evidence.media.status` | `present / partial / missing_suspected / none_detected / unknown / not_checked` | 본문 미디어의 검사 결과 |
| `evidence.coverage` | `complete / limited / unknown` | HTML·추출·미디어 검사 범위; 전체 렌더링을 뜻하지 않음 |
| `evidence.confirmation` | `not_required / pending / repeated` | 재확인 상태 |
| `evidence.ai.state` | `not_needed / not_configured / pending / completed / uncertain / failed` | 모델 처리 상태 |

공개 `BookmarkHealthEvidence`는 `schemaVersion:1`, `observedAt`, `content:{applicable,status,title,textLength,textHash,excerpt,reasonCodes}`, `media:{applicable,status,discovered,checked,reachable,missing,restricted,unknown,excludedCount,duplicateCount,omittedCount,items}`, `coverage`, `confirmation`, `confirmationEvidence:{firstObservedAt,firstFingerprint,confirmedAt}`, `baselineCheckId`, `ai:{state,model,choice,confidence,reservationId}`, `reasonCodes`를 가진다. nullable 값은 확인하지 못했음을 뜻한다. `media.items`는 최대 20개이며 `{kind:'image'|'video'|'embed',label,urlHash,state:'reachable'|'missing'|'restricted'|'unknown',httpStatus,reasonCode}`다. `label`은 query·fragment가 없는 host/path의 160자 이내 표시값이고 원본 주소는 덮어쓰지 않는다.

필수 의미 규칙:

- `present` 미디어는 해당 파일/제공자 응답을 확인했다는 뜻이다. 화면 표시는 **미디어 응답 확인**, 동영상에는 **재생 미확인**을 병기한다. 완전한 이미지 decoding·원래 사진의 의미·영상 전체 재생을 보장하지 않는다.
- 정상 본문에서 이미지가 0개라는 이유만으로 삭제를 의심하지 않는다. 과거 정상 관측이 없으면 `none_detected`다.
- 과거 `present` 본문과 도달 가능한 미디어가 있었고, 현재 완전한 본문 추출에서 미디어 참조가 사라졌을 때만 `missing_suspected`를 제안한다. 예전 개수만으로 특정 이미지 삭제를 확정하지 않는다.
- 확인된 미디어 중 하나라도 실패하면 `partial` 또는 `missing_suspected`; 일부만 확인했다면 실패가 없어도 `coverage=limited`이며 전체 정상으로 표시하지 않는다.
- 401·403·407·429, 로그인·인증·봇 차단, 만료 URL은 삭제 증거가 아니다. `restricted` 또는 `unknown`으로 남긴다.
- HTML 잘림, 지원하지 않는 charset·압축·문서 유형, JS shell, 본문 경계 불명확, 지원하지 않는 embed는 `limited/unknown`이다. 빈 추출을 삭제로 확정하지 않는다.
- 문서에 인용된 “삭제된 게시물” 문장과 실제 삭제 화면을 구분한다. 바이트 수·본문 길이·hash 변화만으로 삭제나 내용 대체를 확정하지 않는다.
- 원문이 HTTP 404인 경우 본문·미디어는 `not_checked`다. 원문 접속 실패를 별도 미디어 검사 실패로 부풀리지 않는다.
- 직접 미디어의 `content.applicable=false`와 `not_checked`는 정상적인 비대상이며 확인 불가 후보가 아니다. PDF 등 내용을 지원하지 못한 경우는 `applicable=true/unknown`이다. `checked=reachable+missing+restricted+unknown`, `discovered>=checked`를 지킨다.

## 5. 문서 수집과 미디어 검사

### 5.1 원문

공통 추출을 모든 안전한 URL의 기본 경로로 사용한다. 도메인별 선택자는 일반 기능의 필수 allowlist가 아니다. `article`, `main`, `[role=main]`과 본문 텍스트·구조를 함께 평가하고 navigation·footer·광고·반복 UI를 제외한다. 판단 가능한 주영역이 없으면 일반 추출 결과를 Jev에 제공하되 범위를 불명확으로 기록한다.

원문은 GET 1회로 접속 상태와 내용을 함께 관측한다. 자동 요청에는 사용자 cookie·앱 Authorization을 전송하지 않는다. UTF-8 및 `TextDecoder`가 지원하는 선언된 charset을 사용하며, 한글 legacy 인코딩을 UTF-8 오독 상태로 정상 판정하지 않는다. 압축 해제 전후 각각 byte 한도를 적용한다. 잘린 문서의 뒤쪽 미디어 부재를 추론하지 않는다.

직접 이미지/동영상 URL은 HTML 경로로 실패시키지 않고 해당 리소스 검사로 전달한다. PDF 등 나머지 문서는 접속 결과와 `CONTENT_TYPE_UNSUPPORTED`를 기록한다.

### 5.2 미디어

본문 영역의 `img/src`, `srcset`, lazy-load `data-src`, `picture/source`, `video/source`, `iframe`을 탐색한다. 상대 주소를 최종 페이지 URL로 해석하고 정확한 원래 query를 유지한다. 광고·avatar·icon이라는 구조적 근거가 있는 참조만 제외한다. 제외/중복/한도 초과 개수를 별도로 센다.

일반 이미지와 직접 동영상은 제한된 GET으로 상태·MIME·파일 signature를 대조한다. HEAD만으로 결정하거나 동영상 본문 전체를 받지 않는다. 200 HTML 오류 화면을 이미지 정상으로 세지 않는다. 삭제 대체 이미지처럼 의미 판정이 필요한 이미지 응답은 `reasonCode=MEDIA_SEMANTICS_UNVERIFIED`를 보존한다. 알려진 삭제 대체 signature가 확인될 때만 삭제 의심으로 올리며, 시각 AI를 필수 검사로 추가하지 않는다.

YouTube는 기존 URL 정규화와 `listYouTubeVideos`의 배치 한도를 재사용한다. 응답 누락은 삭제·비공개를 구별할 수 없는 **제공자 확인 불가**다. 기존 adapter는 embeddability·지역별 재생을 증명하지 않으며 새 검사가 이를 암묵적으로 보장해서는 안 된다. 다른 embed는 참조·응답까지만 기록한다.

미디어는 문서 순으로 최대 20개를 검사하며 한 claim에서 최대 2개를 처리하고 cursor를 저장한다. 동시에 같은 host에 하나만 요청한다. 페이지를 다시 수집하면 만료된 미디어 URL을 최신 참조로 교체하고, 일반 query를 지워 예전 URL과 억지로 일치시키지 않는다. 자동 미디어 재요청에서는 query/fragment를 제거한 검사 원문 origin/path만 Referer로 사용한다. cookie·Authorization은 보내지 않으며 403을 우회하려고 헤더를 바꾸어 반복하지 않는다.

### 5.3 제안 상한

| 항목 | 값 |
| --- | --- |
| 원문 wire/decoded body | 각각 524,288 bytes |
| 미디어 1개 응답 body | 65,536 bytes; HTTP Range를 요청해도 실제 읽기를 강제 제한 |
| 외부 요청 | 10초, redirect 최대 5회 |
| HTML+단계별 작업 checkpoint | 최대 65,536 bytes; 원문 전체 저장 금지 |
| 미디어 참조 보관/검사 | 최대 20개; 넘으면 limited |
| 한 media claim | 최대 2개; 누적 20초 전에 새 요청 시작 중단 |
| 같은 host | 동시 1개, 종료 후 최소 2초; 오류 시 Retry-After 우선 |
| 공개 evidence | 최대 8,192 bytes; 발췌 500자, 미디어 label 160자 |

checkpoint에는 발췌·추출 지표·최대 20개 원본 미디어 참조만 둔다. URL 길이 때문에 byte 상한을 넘으면 URL을 자르지 않고 뒤 참조를 제외해 omittedCount/limited를 기록한다. 공개 evidence가 상한을 넘으면 표시 label/발췌를 줄이고 원래 개수·실패·coverage를 유지한다. 이미 완료한 item은 raw 참조를 지우고 공개 evidence와 hash만 남긴다. 기존 `safeFetch.body` 반환을 유지하면서 binary bytes·truncation·retry 정보를 추가하므로 metadata 등 기존 caller를 함께 회귀 검사한다.

## 6. Jev 판정과 비용

모델 `typesafe/jev-1.13`, 응답 모델 `typesafe/jev-1.13-20260917`, 경로 `/api/v1/systemone`, `allow_fallbacks:false`, `max_price:{prompt:0.042,completion:0}`를 유지한다. 현재 공개 문서는 Decisions와 System One 모두 같은 OpenRouter 계정으로 제공한다고 설명하므로 경로 전환은 하지 않는다.

명확한 HTTP 실패·인증·구조적 정상 근거는 규칙으로 처리한다. 본문 존재가 애매하거나 삭제·대체 안내가 의심되는 안전한 문서와, 명확히 정상으로 분류한 결과 중 일일 최대 10건의 표본에 Jev를 사용한다. 규칙이 정상이라고 주장하는 영역도 표본 검토로 누락을 측정한다. 본문을 얻지 못한 경우 URL만 모델에 주고 상상으로 판정시키지 않는다.

한 요청의 질문은 두 개다.

- `pageState`: `present / deleted / restricted / unrelated / unknown`.
- `basis`: `deletion_notice / auth_notice / content_match / content_mismatch / insufficient`.

입력은 북마크 제목, origin, 추출 제목·발췌·구조 지표·삭제/인증 신호·미디어 집계다. 메모·태그·관심 주제·원본 가져오기 JSON·cookie·URL query/fragment를 보내지 않는다. 전체 JSON 12,000 bytes 이하이며 핵심 근거가 잘렸으면 `unknown`이다. 입력은 데이터이며 지시가 아님을 질문에 명시한다. Jev는 URL을 가져오거나 사용자 정리 작업을 수행하지 않는다.

선택지·확률 키·합계 오차 0.01 미만·선택 순위·confidence 범위·모델·usage·cost를 검증한다. 제안 threshold는 선택 확률과 confidence 모두 0.90 이상이다. 이는 정확도 90% 보장이 아니며 실제 표본에서 조정할 값이다. threshold 이하 또는 근거 질문과 모순되면 `unknown`; 높은 AI confidence도 접속 차단이나 제한된 추출을 정상/삭제로 덮어쓰지 않는다.

예약은 기존과 같은 보수적 상한 `65,536 tokens × 42 nano = 2,752,512 nano-dollar`다. 실제 단가·예약 상한은 구현 직전 다시 확인한다. 실제 요금은 `usage.cost`로 정산한다. 오류 출력이라도 알려진 비용은 정산하고, 응답이 유실되면 해당 예약을 `uncertain`으로 유지한다.

`health_evidence_key = SHA-256(bookmarkId + urlKey + canonicalDecisionState + model + questionRevision)`를 예약 행에 고유하게 보존한다. canonicalDecisionState는 실제로 전송하는 정제 state 전체를 안정된 key 순서로 직렬화한 값이므로 제목·본문·미디어 지표·baseline 근거가 바뀌면 key도 바뀐다. 같은 근거의 정산 완료 결과는 재사용하고, 불명확 예약이 있으면 동일 모델 요청을 자동 반복하지 않는다. 서로 다른 북마크의 결과를 공유하지 않는다.

예산 부족은 근거를 버리지 않고 해당 AI 단계만 다음 KST 월 경계까지 기다린다. 다른 항목의 접속·본문·미디어 수집은 계속한다. 키 미설정은 `not_configured/unknown` 결과로 끝내며 유료 AI를 설정하지 않아도 검사를 사용할 수 있다. 비용 불명확은 해당 item을 `failed`로 표시하고 예약 확인 전 자동 AI 재개를 금지한다. 다른 item은 처리한다.

가격 예시: 3만 건, 요청당 질문 포함 총 2,000 input tokens, AI 처리 비율 10%이면 `$0.252`; 전체 AI이면 `$2.52`. 서버·대역폭·재검사·세금·다른 AI 사용량을 포함하지 않는 계산이다. 정확도·10% 비율·운영 처리량은 아직 실측하지 않았다.

## 7. DB와 동시성

### 7.1 저장 위치

- `bookmark_checks`에 nullable `checked_url text`, `evidence jsonb`와 `evidence_revision integer not null default 1`을 추가한다. 과거 URL/evidence는 null 그대로 둔다. 기존 접속 필드는 유지한다. 같은 검사 행의 잠정/최종 근거가 바뀔 때마다 evidence_revision을 증가시킨다.
- `bookmark_job_items`에 `work jsonb`를 추가한다. `result`는 기존 결과 계약을 유지하고, work에 `HealthWork` checkpoint를 보존한다.
- `bookmark_settings`에 `health_auto_enabled boolean default false`, `health_daily_limit integer default 500 check between 1 and 1000`을 추가한다. migration 적용만으로 외부 요청을 시작하지 않는다. 실제 자동 기능 검증은 Settings에서 활성화한 뒤 수행한다.
- `bookmark_ai_reservations`에 nullable `health_evidence_key text unique`, `health_bookmark_id uuid`, `health_decision jsonb`를 추가한다. health_decision은 검증된 choice/basis/confidence만 저장하는 작은 결과이며 모델 입력은 보관하지 않는다. 기존 작업의 null 값·영수증·모델별 집계는 유지한다.
- `private.bookmark_health_hosts(host primary key, lease_token, lease_expires_at, next_allowed_at)`는 검사 host의 동시 요청과 backoff를 공유한다. 직접 Data API에 노출하지 않는다.

새 public 열은 기존 owner RLS를 따르고 모든 새 privileged 함수는 PUBLIC/anon/authenticated 실행을 명시적으로 취소한다. owner RPC만 소유자를 검사해 Settings·시작 결과를 반환한다. 네트워크/AI worker 함수는 service_role 전용이다.

기본 비교 기준은 동일 URL의 최근 `content.present`이며 추출 범위가 명확한 검사다. baseline과 현재 최신 검사, 사용자 event가 참조한 검사는 보존한다. 완료 30일이 지난 비참조·비baseline 검사 payload는 지우되 status·reason·시각·버전은 보존한다. 이 정리는 기존 일일 등록 시 하루 최대 500행만 수행하고 별도 cron을 만들지 않는다. 원문 전체·미디어 파일을 DB에 저장하지 않는다.

### 7.2 단계와 commit

`HealthWork.phase`는 `page → media → decision → confirm → done`이다. 실제 호출 순서에서 불필요한 단계는 건너뛰며, 모든 경로가 동일한 최종 evidence 계약을 사용한다. 각 단계 전후 checkpoint·lease·item available_at을 DB에 저장하고 실제 network는 transaction 밖에서 실행한다. 새로운 worker 프로세스가 메모리 없이 재개할 수 있어야 한다. work는 최초 의심의 `confirmationFingerprint`·`confirmationFirstObservedAt`과 `confirmationAttempts`(0 또는 1)를 보존한다. confirm 기한에는 원문부터 새로 수집하고 media cursor를 0으로 시작한다. 검사당 재확인은 최대 한 번이며 동일 의심 근거가 반복되면 repeated, 회복하면 현재 정상 관측, 결과가 불일치하면 unknown과 `CONFIRMATION_INCONCLUSIVE`로 끝내고 무한 재확인을 만들지 않는다. 공개 evidence에도 첫 관측 시각·근거 hash·재확인 시각을 남겨 시간 간격을 readback으로 검증한다.

호스트 permit은 요청 직전에 획득하며 15초 후 만료한다. 종료 시 token이 같은 경우에만 해제하고 `next_allowed_at=종료+2초`를 설정한다. 429/503 Retry-After는 최대 24시간, 없으면 15분 backoff다. permit이 없으면 item을 해당 시각까지 기다리게 하고 worker thread를 sleep하지 않는다. redirect 대상도 다시 DNS/SSRF·permit을 검사한다.

AI 예약 RPC는 job lease·bookmark·관측 key를 확인한 뒤 기존 예산 예약과 work의 reservation ID 연결을 한 transaction으로 처리한다. 응답은 신규 reserved, 기존 결과 cached, 비용 uncertain, budget_wait, 비용은 알려졌으나 출력이 잘못된 output_failed를 구분한다. cached만 기존 health_decision을 재사용하며 uncertain/output_failed를 신규 유료 호출로 대체하지 않는다. `check` 작업의 crash 복구는 예약에 연결된 item만 uncertain/failed로 전환한다. `check` job 전체를 일반 AI job처럼 일괄 pause하지 않는다. 비용 정산은 reservation ID에 대해 멱등이며, 늦게 도착한 알려진 비용은 정산하되 만료 lease나 수정된 북마크에 판정을 적용하지 않는다.

result commit은 `job lease + expected_version + checked_url`을 검사한다. 북마크 수정·휴지통 이동·더 최신 관측과 충돌하면 stale 결과로 남기고 현재 표시/필터를 덮어쓰지 않는다. 비용은 별도로 정산한다. 오래된 budget 대기 결과가 나중에 도착해도 `checked_at`은 실제 원문 관측 시각이며 새 검사처럼 바꾸지 않는다.

작업 상태는 접속 정상률이 아니다. 모든 item의 관측이 끝났고 실제 대기/실패가 없으면 `succeeded`; AI/재검사/host 대기가 남으면 `retry`; 끝난 item과 실행 실패가 섞이면 `partial`; 전부 실행 실패면 `failed`다. 관측 결과 `unknown`은 완료할 수 있지만 반드시 unknown 집계로 노출한다. 예산 대기를 완료나 정상으로 숨기지 않는다.

## 8. 자동 선정과 수동 중복

자동은 `Asia/Seoul` 기준 09:00 이후 첫 정상 분 단위 dispatch에서 등록한다. cron 자체는 기존 한 개를 유지하고 `dispatch_bookmark_worker()`의 빈 작업 판단 전에 `enqueue_bookmark_health_daily()`를 실행한다. 오늘 job이 있거나 비활성화·대상 0개이면 새 job을 만들지 않는다. 날짜별 advisory lock과 automatic date 고유 index로 중복 dispatch를 막는다. 자동 비활성화는 신규 등록과 자동 job의 새 claim을 중단하고, 이미 시작된 요청의 정산·commit은 마친다. 다시 켜면 기존 작업부터 재개한다.

일일 기본 500개는 신규 등록한 북마크 수이며 각 item의 단계 수가 아니다. 재확인 요청은 이 대상에 속하며 별도 신규 북마크로 세지 않는다. 수동 요청은 일일 자동 개수와 별개지만 동일한 host 제한·AI 월 예산을 따른다.

후보는 `library` 전체이며 출처 allowlist나 컬렉션을 요구하지 않는다. 오래 저장한 항목을 먼저 돌되 새 항목도 영구 제외하지 않는다. 최근 검사와 관계없이 저장 날짜만 오래됐다고 계속 같은 항목을 검사하지 않는다.

선정량 `L` 중 최대 `floor(0.1L)`은 최근 정상 항목의 표본, 최대 `floor(0.2L)`은 재검사 예정인 의심·제한 항목, 나머지는 미점검/기한 도래 항목이다. 정상 표본 중 순서상 최대 10개에만 decisionSample=true를 붙인다. 다른 표본도 실제 원문·미디어를 검사하며, 검사 중 의심이 생기면 표본 한도와 별개로 AI 대상이 될 수 있다. 남은 자리는 일반 후보로 채운다. 일반 순서는 미점검 우선 → 마지막 검사 오래된 순 → saved_at/id다. 표본은 도메인별 round-robin 안에서 날짜+ID hash로 선택한다. 같은 날 결과는 안정적이며 도메인 하나가 표본을 독점하지 않는다. 예산 대기 중인 AI item과 실제 원문 수집 backlog는 구분한다.

정상/none_detected의 일반 재검사는 90일, restricted·unknown은 7일, 삭제/미디어 의심은 첫 관측 후 24시간 뒤 재확인하고 이후 30일이다. HTTP 404·410·NXDOMAIN의 기존 1분 재확인은 별도로 유지한다. 일일 표본은 최근 7일 이내 검사한 항목을 제외한다. 첫 단발성 의심부터 근거와 ‘재확인 예정’을 표시하고, 재확인 전 확정 삭제로 표시하지 않는다.

전날의 page/media/confirm backlog가 있으면 새 자동 job을 등록하지 않고 기존 것을 이어간다. 미래 시각의 AI budget 대기만 남은 것은 신규 원문 검사를 막지 않는다. 실패·비활성화·설정 누락·기한 내 미등록 상태는 Settings/작업 기록에서 구분한다. 놓친 날짜를 몰아서 따라잡지 않는다.

수동 시작은 `bookmarkCheck.start(BookmarkScope)`를 유지하되 반환을 `BookmarkHealthStartResult={job:BookmarkJob|null,requestedCount,queuedCount,reusedCount,activeJobIds:string[]}`로 명시적으로 확장하고 모든 caller를 갱신한다. DB transaction에서 동일 북마크·URL·버전의 page/media/confirm 진행분을 재사용한다. 두 동시 시작도 advisory lock 아래 한 번만 등록한다. AI만 기다리는 작업 때문에 새 수동 원문 수집을 막지 않는다. 새 job이 0개이면 가짜 성공 job 없이 기존 작업 링크를 반환한다.

claim 우선순위는 저장 추천 → 기존 사용자 작업/수동 검사 → 자동 검사다. 실제 ready item이 없는 job은 claim하지 않으며 budget 대기 job이 queue를 막지 않는다. 우선순위는 현재 처리 중인 외부 요청을 강제로 취소하지 않고 다음 claim부터 적용한다.

## 9. 화면과 API

- Settings `/main/setting/bookmarks`: 자동 점검 on/off·일일 개수(1~1000, 기본 500), KST 09:00 안내, 마지막 자동 등록/진행/설정 오류, 검토 화면 링크. 초기 꺼짐과 활성화 전 외부 원문 발췌가 기존 AI 공급자로 전송될 수 있음을 짧게 설명한다.
- 기존 북마크의 `링크 검사` 버튼과 범위는 유지한다. 요청 결과에 신규/진행 중 재사용 건수와 작업 링크를 보여준다. 버튼을 누른 즉시 판정이 끝난 것처럼 알리지 않는다.
- `reviewType`은 기존 `all/dead/unused/classify`에 `content/media/uncheckable`을 추가한다. `dead`는 기존 HTTP/DNS 의미를 유지한다. content는 본문 삭제·대체 의심, media는 partial/missing_suspected, uncheckable은 제한·unknown·적용 대상의 미확인 원인과 AI 대기다. 이미 dead인 원문 때문에 하위 검사가 생략된 경우나 applicable=false는 미확인 후보를 중복 생성하지 않는다. all에는 새 후보를 합친다.
- 필터는 서버에서 적용하며 전체 건수·페이지·정렬이 일치한다. 집계 후 pagination하는 기존 최적화 구조를 유지한다. 최신 검사 및 현재 URL/버전에 맞는 미검토 결과만 자동 후보로 노출한다. checked_url이 null인 구형 결과는 기존 bookmark_version 일치 규칙으로 접속 필터를 유지한다.
- 행에는 가장 중요한 상태 1개를 짧게 표시하고 상세에서 접속·본문·미디어·범위·시각·AI·재확인 근거를 분리한다. 부분 검사에서 ‘전체 정상’ 표현을 금지한다. 과거 null evidence는 ‘이전 방식: 접속만 확인’이다.
- 유지·휴지통은 기존 owner mutation과 version 검증을 사용한다. 상세/행/일괄 유지에서 본 evidenceId와 evidenceRevision을 전달해 그 근거를 확인했다는 기록을 남긴다. 새 검사 또는 같은 행의 갱신된 근거가 도착했다면 유지 요청은 충돌로 돌려보내고 새 결과를 다시 보여준다. health 결과 확인은 collection classify 제안을 승인/제외하지 않는다.
- 작업 기록에는 origin(자동/수동), 관측 완료·대기·실패, unknown/AI 대기 개수, 재개 제한 사유를 표시한다. 새 결과가 추가되면 새로고침 없이 목록/상세를 invalidate한다. 키보드·모바일·초점 복귀를 유지한다.

신규 owner API는 `bookmarkCheck.settings.query()`와 `bookmarkCheck.updateSettings.mutate({enabled:boolean,dailyLimit:number})`다. 응답은 `{enabled,dailyLimit,timeZone:'Asia/Seoul',hour:9,lastAutomaticJob:BookmarkJob|null}`이며 service_role/Vault 값이나 host lease token을 반환하지 않는다.

## 10. 파일 책임과 실행 전제

공개 schema는 `contracts/bookmark-health.schema.ts`, 추출은 `health-content.ts`, 미디어 응답은 `health-media.ts`, Jev 질문/검증은 `health-decision.ts`, 단계 진행은 `health-worker.ts`, UI 표시 규칙은 `lib/bookmark-health.ts`에 둔다. 새 파일은 모두 기존 bookmark 디렉터리 옆에 두며 일반 AI 프레임워크·새 큐·provider 추상화를 만들지 않는다. `worker.ts`는 check 위임과 공통 claim/commit만 연결한다.

구현 때 CLI가 발급한 additive migration으로 계약·worker·scheduler 변경을 분리한다. 현재 설계 중에는 migration 파일을 생성하지 않는다. 공유 DB reset 없이 기존 백업/격리 검증 절차를 사용하고, 추가 migration만 적용한다. 이미 실행 중인 구형 check 작업은 pause해 같은 작업을 새 검사 방식으로 재개하게 하며 기존 결과는 접속 근거로 보존한다.

## 11. 검증과 남는 한계

단위 테스트는 200 삭제 안내/인용문, JS shell, lazy media, 부분 검사, 200 HTML 이미지 오류, 한글 charset, 압축·잘림, direct media, private redirect, host 경합, AI invalid/known-cost/uncertain을 고정한다. pgTAP와 실제 동시 session은 owner/RLS·날짜 경계·중복 등록·lease·stale commit·예산·필터 건수/페이지를 검사한다. 기존 HTTP 200 테스트는 접속 의미를 유지하고 새 content 테스트를 추가한다.

실제 검증은 자연스러운 UI에서 시작한다. 첫 표본 30개는 적어도 5개 도메인, 정상 텍스트·이미지·영상, 삭제, 일부 미디어 실패, 로그인/봇 차단, JS 의존 유형을 포함한다. 실제로 찾지 못한 유형은 미검증으로 적고 fixture로 대체 PASS하지 않는다. 수동 소량 검사와 자동 활성화 후 실제 cron 등록/worker 실행을 각각 관측한다. 자동 검증을 위해 scheduler SQL·worker를 직접 호출하거나 시계를 바꾸지 않는다.

후보는 직접 브라우저로 원문과 비교한다. 가능한 실제 실패 사례에서 사용자 유지 및 휴지통/복원 후 readback을 확인한다. 정상·불명확을 포함한 표본 10개 이상은 실제 Jev 요청과 영수증도 대조한다. 표본에서 확인한 상태를 정답 라벨로 보존하고 정상 링크를 삭제 의심으로 낸 비율·의심 후보 적중률·확인 불가율·AI 호출률·전송량·처리 시간을 보고한다. 30개는 품질 탐색이며 정확도 보증이 아니다.

지원하지 않는 동적 사이트, 모든 영상의 실제 재생, 모든 이미지의 의미·완전한 decoding은 자동으로 보장하지 않는다. 이러한 한계를 UI의 unknown/범위 표시로 드러내고 원문 열기로 이어지게 한다. 주 기능은 접속뿐 아니라 실제로 읽은 본문·미디어 응답을 근거로 후보를 만드는 것이다.

## 12. 외부 근거와 자체 검토

2026-10-22에 확인: [Jev 1.13 가격](https://openrouter.ai/typesafe/jev-1.13), [OpenRouter Jev 경로](https://openrouter.ai/docs/guides/community/jev), [Choice 계약](https://docs.typesafe.ai/primitives/choice), [Supabase Cron](https://supabase.com/docs/guides/cron). 가격은 입력 100만 token당 `$0.042`, 출력 무료이며 문서의 비용 계산과 예약 상한을 교차 확인했다. 실제 서비스 호출은 하지 않았다.

자체 검토: 접속과 내용 판정 분리, 최초 baseline 부재, 부분 검사, 직접 미디어, 권한/SSRF, 항목별 비용 불명확, 자동/수동 중복, 예산 대기의 독립 처리, 구형 결과 호환과 UI readback을 설계에 포함했다. 브라우저 자동 실행·시각 AI·원문 보관을 필수 경로로 만들지 않았다. 운영 상태와 정확도는 아직 검증되지 않았다.
