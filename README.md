# Applemint v3

개인용 트렌드 링크 수집/정리 프로젝트입니다.  
여러 커뮤니티 소스를 크롤링해 `new-threads`에 적재하고, 웹 UI에서 빠르게 확인/분류(`Quick Save`, `Trash`)할 수 있도록 구성되어 있습니다.

> 이 문서는 개인 프로젝트 운영 관점에 맞춰 작성되었으며, 설치/배포 가이드는 의도적으로 제외했습니다.

## 주요 기술 스택

### Frontend
- `Next.js 15` (App Router)
- `React 19` + `TypeScript (strict)`
- `@tanstack/react-query` (목록/무한 스크롤/캐시 무효화)
- `Tailwind CSS` + `shadcn/ui`(Radix 기반 컴포넌트)
- `lucide-react`, `sonner`, `vaul`, `next-themes`

### Backend / Data
- `Supabase Auth` + `@supabase/ssr` (쿠키 기반 SSR 인증)
- `Supabase Postgres` (`new-threads`, `quick-save`, `trash`, `crawl-history`, `filter-keyword`)
- `Supabase Edge Functions` (`supabase/functions/crawl-source`)
- `SQL migration` 기반 성능 튜닝 및 RPC (`get_new_threads_stats`)

### Crawling / Parsing
- `fetch` / `undici` 네트워크 요청
- `cheerio` HTML 파싱
- `linkifyjs` URL 추출
- 소스별 크롤러 모듈 분리 (`arcalive`, `battlepage`, `insagirl`, `issuelink`)

### 품질 / 보안 유지보수
- `Biome` 포맷/린트 규칙
- `ESLint (next/core-web-vitals 계열)`
- GitHub `CodeQL` 워크플로우
- `Dependabot` 주간 보안 업데이트
- 커스텀 보안 스크립트 (`scripts/security/*`)

## 핵심 기능

- 인증 사용자만 `/main` 접근 가능 (서버 레이아웃 + 미들웨어 세션 갱신)
- 소스별 크롤링 결과 수집 후 중복 제거 및 타입 분류(`normal`, `media`, `youtube`)
- `new-threads` 무한 스크롤 목록 + 타입별 통계/필터
- `Quick Save` 이동, `Trash` 이동/복원 워크플로우
- 설정 페이지에서 수동 크롤링 트리거 및 신규 스레드 일괄 정리

## 아키텍처 개요

1. UI(`/main/setting`)에서 수동 크롤링 호출  
2. `app/api/crawl/manual`이 Supabase Edge Function(`crawl-source`) 호출  
3. Edge Function이 다시 내부 크롤링 API(`app/api/crawl?target=...`) 호출  
4. 크롤링 결과를 `filter-keyword` 기준으로 필터링/타입 분류/미디어 확장  
5. `crawl-history` 업서트로 중복 유입 차단 후 `new-threads` 적재  
6. UI는 `app/api/new-threads`, `app/api/new-threads/stats`로 조회

## 프로젝트 구조

```text
app/
  api/
    crawl/                 # 소스별 크롤러 + 통합 크롤링 엔드포인트
    new-threads/           # 신규 스레드 목록/통계 API
  auth/, login/, signout/  # 인증 흐름
  main/                    # 메인, 퀵세이브, 휴지통, 설정 화면

components/
  ui/                      # shadcn/ui 기반 공통 컴포넌트

utils/
  supabase/                # browser/server/middleware 클라이언트 팩토리

supabase/
  functions/crawl-source/  # 크롤링 적재 파이프라인 Edge Function
  migrations/              # 인덱스/RPC 등 DB 변경 이력

scripts/security/          # GitHub 보안 알림 수집/게이트 스크립트
reports/security/          # 보안 점검 결과 산출물
lib/                       # 공통 타입/유틸
```

## 유지보수 가이드

### 1) 크롤러 소스 추가/변경
- `app/api/crawl/<source>.ts`에 소스별 수집 로직 구현
- `app/api/crawl/route.ts` 스위치에 타겟 등록
- 반환 타입은 `CrawlItemType` 일관성 유지 (`url`, `title`, `host` 필수)
- 소스 장애 대비 재시도/로그 전략 유지 (`retryOperation`, `logger.ts`)

### 2) 데이터 분류/필터 정책 관리
- 타입 분류 기준은 `supabase/functions/crawl-source/index.ts`의 `defineType`에서 처리
- 무시 키워드/분류 키워드는 DB `filter-keyword` 테이블에서 제어
- 미디어 확장자/Imgur 처리 로직 변경 시 `getMediaData` 영향 범위 확인

### 3) 조회 성능 및 통계 로직
- 목록 API는 커서 기반(`id < cursor`) 페이지네이션 사용
- 통계는 Postgres RPC `get_new_threads_stats`를 통해 집계
- 쿼리 변경 시 API(`app/api/new-threads/*`)와 SQL 함수를 함께 수정

### 4) 보안 운영
- 기준 문서: `SECURITY.md`
- 로컬 보안 점검:
  - `pnpm security:collect-alerts`
  - `pnpm security:gate`
- CI에서는 CodeQL + Dependabot 흐름으로 지속 점검

### 5) 코드 컨벤션
- TS strict + 경로 별칭 `@/*`
- 포맷/린트 규칙은 `biome.json` 기준
- 신규 데이터 모델 필드 추가 시:
  - `lib/typeDefs.ts`
  - Supabase 관련 쿼리 코드
  - 통계/필터 API 및 UI 표시부
  를 함께 동기화

## 유지보수용 주요 환경 변수

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (서버 전용)
- `SUPABASE_URL` (manual crawl fallback)
- `CRAWL_API_BASE_URL` (Edge Function -> 내부 크롤링 API 주소)
- `NEXT_PUBLIC_IMGUR_CLIENT_ID` (Imgur 미디어 확장)
- `DEBUG_CRAWL`, `LOG_LEVEL`
- `MEDIA_FETCH_CONCURRENCY`
- `GITHUB_TOKEN` 또는 `GH_TOKEN` (보안 스크립트 실행 시)
