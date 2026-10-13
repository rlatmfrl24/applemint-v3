# Applemint 북마크 구현·운영 기록

Applemint DB를 북마크 원본으로 사용한다. Raindrop은 최초 한 번 읽으며 후속 동기화와 되쓰기는 없다. 기존 Quick Save는 수집 글 상태 이동 기능으로 유지한다.

## 사용 흐름

| 진입점 | 사용자 동작과 저장 결과 |
|---|---|
| `/main/bookmarks` | URL 저장, 컬렉션 탐색·생성·이름 변경, 제목·태그·메모·소속 수정, 검색·페이지 이동 |
| 수집 글의 북마크 저장 | 같은 저장 창을 사용한다. 서버가 수집 글 URL을 재확인하며 원래 글의 상태는 유지한다. |
| 라이브러리의 링크 검사 | 전체·현재 컬렉션·선택 항목 중 범위를 지정하고 작업을 등록한다. 브라우저를 닫아도 상태가 남는다. |
| 검토 탭 | 오래됨(180일)·중복·최신 검사·AI 의견을 검토한다. 사용 기록이 없으면 과거 사용 여부를 불명으로 표시한다. |
| 유지·휴지통·복원 | 사용자 선택만 DB에 반영한다. 같은 검토의 유지 결과는 다시 미처리로 표시하지 않으며 복원 시 메모·태그·소속을 보존한다. 선택 항목 일괄 처리를 제공한다. |
| AI 컬렉션 분류 | 현재 소속 → 제안 소속과 이유를 확인한다. 이름·대상 수정 후 개별 승인, 선택한 북마크마다 최신 유효 원안 한 개의 일괄 승인·제외를 제공한다. |
| `/main/setting/bookmarks` | 최초 이관·관심 주제 수정 및 확정·AI 예산·실패 항목·재개 상태를 확인한다. |

직접 저장은 같은 정규화 URL이 있으면 기존 항목을 안내한다. Raindrop의 서로 다른 원본 ID가 같은 URL을 가리키는 자료는 모두 보존한다. 제목·설명 수집은 DB 저장 뒤 별도 작업이며 실패해도 저장한 자료는 남는다. ‘열기’는 버튼 사용 기록이며 방문 완료·완독의 증거가 아니다.

Raindrop 미분류는 Applemint의 같은 미분류 보기로 합친다. 이관 원본의 미분류 ID·소속 기록은 별도로 남으며 화면과 AI에는 중복된 미분류 컬렉션을 만들지 않는다.

## 데이터와 권한

- `bookmarks`, `bookmark_collections`는 수집 글과 별도 원본이다. `original`과 `source_id`에 가져온 정보·원래 계층·소속을 남기고 현재 분류와 휴지통 상태는 별도로 관리한다.
- `bookmark_jobs`, `bookmark_job_items`가 작업·진행·재시도·실패 결과를 보존한다. YouTube queue를 재사용하지 않는다.
- `bookmark_checks`, `bookmark_proposals`, `bookmark_events`가 검사·제안·검토·열기 이력을 보존한다. `bookmark_import_verifications`는 이관 완료 전 원본 ID와 소속을 대조한다.
- 소유자 tRPC는 `bookmark`, `bookmarkCollection`, `bookmarkImport`, `bookmarkCheck`, `bookmarkAI`, `bookmarkProposal`로 나뉜다. 사용자 DB 세션에는 RLS와 소유자 판정을 적용하며 쓰기는 `bookmark_command` RPC만 수행한다.
- 일반 tRPC 의존성에는 service-role 클라이언트를 넣지 않는다. worker는 내부 인증 후 서버 권한으로 허용된 RPC만 호출하며 북마크 테이블 직접 권한을 갖지 않는다.

수정·휴지통·복원·분류 승인에는 북마크 버전을 확인한다. AI 검토는 열기·유지의 `review_revision`과 관심 주제 버전도 확인한다. worker와 승인 RPC는 같은 순서로 필요한 행을 잠그며 오래된 근거가 사용자 결정을 덮어쓰지 못한다. 일괄 변경은 모두 성공하거나 모두 롤백한다.

## 서버 설정과 작업 실행

`.env.example`을 기준으로 서버의 `RAINDROP_IMPORT_TOKEN`, `OPENAI_API_KEY`를 설정한다. `NEXT_PUBLIC_` 접두사를 사용하지 않는다. 설정 화면에는 존재 여부만 표시한다.

worker는 `/api/bookmarks/worker`의 POST이며 `x-applemint-internal-secret`으로 32자 이상의 `CRAWL_INTERNAL_SECRET`을 검증한다. Supabase Cron은 1분마다 **이미 등록된 작업만** 진행한다. 예약 실행이 새 검사나 AI 작업을 만들지는 않는다.

Vault의 `bookmark_app_base_url`, `bookmark_internal_secret`을 서버 주소·내부 인증 값과 맞춘다. 없으면 기존 `crawl_app_base_url`, `crawl_internal_secret`을 사용한다. 로컬 Docker에서 호스트 서버에 연결할 때 주소는 `http://host.docker.internal:3000`이다. 비밀 값은 로그·문서·브라우저에 기록하지 않는다.

DB 변경은 다음 두 migration에 있다. 이 작업에서는 로컬 DB에만 적용했으며 운영 적용과 배포는 수행하지 않았다.

1. `20261013015432_bookmark_library.sql`: 테이블·RLS·소유자 및 worker RPC·예산·Cron
2. `20261013020637_bookmark_worker_context.sql`: worker 전용 대조·태그 입력 조회

## 일회 이관과 재개

백업과 소량 조회 대조 후 설정 화면에서 시작한다. 최상위·하위·빈 컬렉션과 미분류를 포함하며 휴지통(-99)은 제외한다. 페이지는 50개씩 읽고 원본 ID로 중복 생성을 막는다. 중단된 작업의 재개는 최초 계정을 유지한 채 manifest와 첫 페이지부터 다시 읽는다. 이미 가져온 자료의 현재 분류·휴지통 상태·원본 기록은 덮어쓰지 않는다.

저장 이후 별도의 페이지 조회로 고유 원본 ID, 원래 소속, 수량과 컬렉션 ID·이름·부모 관계를 대조한다. 일치해야 `succeeded`이며 불일치는 `partial`이다. 완료 후 신규 이관을 거부하고 임시 토큰 제거를 안내한다.

Raindrop은 이 조회에 일관된 시점의 전체 snapshot을 제공하지 않는다. 이관·대조 중 원본을 수정하지 않는 것이 필요하다. 이미 가져온 원본을 삭제·이동했을 때 Applemint에서 자동 삭제하거나 원본 기록을 덮어써서 완료로 표시하지 않는다. 불일치는 확인 후 해결해야 한다.

API 근거: [페이지별 목록](https://developer.raindrop.io/v1/raindrops/multiple), [이용 조건](https://developer.raindrop.io/terms). 현재 Free 계정에서 실제 조회를 확인했으며 모든 계정·향후 이용 조건의 보장은 아니다.

## 링크 검사와 AI

HTTP·HTTPS만 요청하고 DNS 응답과 실제 연결 IP를 검증한다. 내부망·예약 주소와 위험한 리다이렉트를 차단한다. 전체 요청 제한은 10초, 리다이렉트는 최대 5회다. 404·410·확인된 NXDOMAIN은 1분 후 재검사해 후보로 표시한다. 로그인·봇 차단·시간 초과·5xx는 죽은 링크로 확정하지 않는다. HTTP 200은 응답 확인이며 내용 유효성의 증거가 아니다.

AI는 OpenAI Responses API의 `gpt-6-luna`, `reasoning.effort=none`, 구조화 출력, `store=false`를 사용한다. 제목·URL·태그·설명·컬렉션 구조·확정한 관심 주제만 분류 입력으로 사용한다. 관심 주제 제안에는 기존 태그 집계를 사용한다. 원문 전체 수집과 요약은 필수 조건이 아니다.

입력 토큰 수는 발송 전에 API로 계산하며, 최대 출력은 호출당 8,192토큰이다. 대상은 기본 20개씩 나누고 입력량이 크면 줄인다. KST 달력 월 기준 $1을 정수 nano-dollar로 관리한다. 캐시 쓰기의 최대 입력 비용과 최대 출력 비용을 원자적으로 예약하고 알려진 응답 사용량으로 정산한다. 청구가 불명확하면 예약액을 유지한다. 예산 부족이나 불명확한 요청은 직접 재개하며 완료된 제안은 남는다. 모델 오류를 규칙 분류의 성공으로 대체하지 않는다.

예산은 이 기능의 API 사용·예약에 대한 기준이다. 세금·환율·다른 앱 사용량을 포함하지 않는다. 전체 라이브러리를 한 달 안에 분류한다는 보장은 없다.

API 근거: [모델](https://developers.openai.com/api/docs/models/gpt-6-luna), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [토큰 계산](https://developers.openai.com/api/docs/guides/token-counting), [가격](https://developers.openai.com/api/docs/pricing), [캐시 사용량](https://developers.openai.com/api/docs/guides/prompt-caching).

## 실제 검증 기록

2026-10-13, `codex/bookmark-library`의 로컬 DB·실제 로그인 UI에서 확인했다.

| 검증 | 결과 |
|---|---|
| 직접 URL 저장·새로고침·중복 안내·휴지통·복원 | 실제 UI와 소유자 DB 조회 일치 |
| 수집 글 저장 | 실제 버튼으로 저장하고 원래 글 상태 유지 확인 |
| 저장 후 제목 수집·열기 | 실제 외부 HTML에서 제목 저장, 열기 버튼 횟수·시각 저장 확인 |
| Free 계정 전체 이관 | 33,418개 저장·원본 ID 재조회 33,418개. 누락·추가·소속 불일치 각각 0 |
| 컬렉션·미분류·중복 | 43개 컬렉션(미분류 포함), 하위 32개, 미분류 북마크 4개. 같은 URL의 284그룹·579개 원본을 보존 |
| 메모·태그·날짜·휴지통 제외 | 원래 응답 대비 불일치 각각 0. Raindrop 휴지통 자료 유입 0 |
| 완료 후 재실행 차단 | 설정 화면에서 이관 완료·검증 일치 확인, 신규 시작 버튼 없음 |
| 수동 링크 검사 | 실제 404의 1분 뒤 재검사 후 후보 표시, 사용자 휴지통 승인·복원과 DB 조회 확인 |
| 동시 DB RPC | 두 세션의 예산 예약이 $1을 넘지 않음. 역순 모델 결과와 일괄 유지 동시 실행에서 교착 없이 최신 선택 보존 |
| 독립 코드 리뷰 | 이관 대조·재개·AI 검토의 동시 변경 경계 수정 후 PASS |

실계정은 빈 컬렉션이 0개여서 해당 보존 경계는 manifest 단위 테스트로 보완했다. 전체 이관 전에 로컬 백업을 준비했으며 실제 자료와 백업은 Git에 넣지 않는다.

Vitest·pgTAP은 권한·입력 경계·원자성·오래된 제안·계정 교체·불명확한 청구·재시도를 검증한다. 공급자 응답 모의 검사는 실패 경계를 지원하며 실제 AI 분류 품질·청구 검증을 대체하지 않는다.

최종 `pnpm verify` **PASS**: Biome·Knip·DB 생성 타입 대조, Vitest 586개(실제 외부 네트워크 2개는 별도 실행), pgTAP 610개, production build, 일반 tRPC의 서버 권한 격리, 기존 화면 bundle 크기 검사. 실제 로그인 UI 검증은 5개가 통과했고, 이관 시작 검사는 앞선 실계정 실행에서 수행했으므로 완료 뒤 재이관하지 않았다. 미분류 통합 후 직접 저장과 완료·단일 미분류 보기를 같은 UI에서 재확인했다.

기존 수집 이력 테스트는 해당 테스트가 만든 실행 ID만 조회하도록 수정했다. Web Push 테스트는 device A를 먼저 완료한다는 후속 검증에 맞춰 fixture의 `available_at`을 명시했다. 운영 수집·Web Push 동작과 권한 기준은 바꾸지 않았다.

실제 OpenAI 관심 주제·분류·수정·승인 흐름은 **API 키 미설정으로 미검증**이다. 운영 DB 적용과 배포도 아직 수행하지 않았다. 이관 완료 후 worktree의 임시 Raindrop 토큰은 제거했으며 원래 작업 폴더의 환경은 보존했다.

로컬 검증 서버는 `pnpm dev:local`로 실행한다. 실자료를 보존하므로 검증을 위해 DB를 초기화하지 않는다.
