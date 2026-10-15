# Applemint 북마크 UI·UX 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline, task by task. Use a fresh reviewer for final whole-branch review.

**Goal:** 컬렉션 탐색 → 목록 → 상세 확인·편집을 연결하고, 자동 저장 추천·명확한 로딩·복구 가능한 낙관적 조작을 제공한다.

**Architecture:** 기존 Next.js/React Query/tRPC/소유자 RPC를 유지한다. 상세는 ID로 조회하고 공통 본문을 데스크톱 패널과 모바일 Drawer에서 사용한다. 낙관적 변경은 원본 infinite-query 페이지 위의 표시 계층으로 처리한다.

**Tech Stack:** Next.js 16.3.8, React 19, 기존 Geist/Tailwind/Radix/Vaul/Sonner/Motion, Vitest/Playwright/pgTAP.

**Spec:** 아래 Product Contract는 사용자가 2026-10-15 이 대화에서 승인하여 구현을 요청한 계획이다. 이전 문서의 수동 추천 정책보다 이 계약이 우선한다.

## Product Contract

### 작업 공간·링크

- 1280px 이상: 컬렉션 240px + 유동 목록 + 선택 시 상세 360px. 닫으면 목록 확장.
- 768–1279px: 컬렉션/목록 + 상세 Drawer. 768px 미만: 목록 기본, 컬렉션/상세는 서로 겹치지 않는 Drawer.
- 검색과 선택 작업 도구 모음은 상단에 유지. 제목은 원문 링크, 상세 버튼은 패널 진입. 제목 최대 두 줄, URL의 40% 제한 제거, 소속과 다른 줄. 모바일 드래그 핸들은 숨긴다.
- 상세는 전체 URL/제목/경로/메모/검사 근거/변경안과 URL 복사를 제공. id + mode로 선택하고 bookmark.detail로 최신 조회. 미저장 편집은 닫기/항목 변경/갱신으로 소실되지 않는다.
- 내부 이동은 Next.js 클라이언트 탐색. 기존 Main/Quick 저장 진입점, 유지/분류 승인의 구분, 컬렉션 삭제 보존 정책 유지.

### 계층

- 사이드바와 공통 선택기에 컬렉션 검색. 검색 결과에 이름/전체 경로. 접기·선택·메뉴 분리, 선택 조상 강조, 열린 폴더와 연결선, 깊은 들여쓰기 제한.
- 목록 상단 경로 탐색. 현재 컬렉션 직접 소속 항목만 조회한다고 표시.
- 드롭의 내부 이동/앞뒤 순서 변경을 구분하고 유효하지 않은 이유 안내. 모바일/키보드용 이동 메뉴 유지.

### 로딩·검색

- 초기에는 트리/행 스켈레톤. 초기 로딩을 빈 상태로 표시하지 않는다. 같은 조건 갱신은 목록/스크롤 유지 + 작은 표시. 다른 조건 캐시 없으면 해당 영역 로딩.
- 추가 로딩/실패는 하단 표시, 기존 항목 보존/재시도. 100개 단위/최대 2000개 선택 유지.
- 검색 입력 즉시, 요청 250ms 디바운스, IME 조합 중 요청 없음, Enter 즉시 검색.
- 라이브러리/검색/컬렉션/검토/휴지통 빈 상태를 구분하고 관련 복구 행동 제공. aria-busy/status 사용, 반복 전체 알림 방지.

### 저장 추천

- 클릭 즉시 눈에 보이는 팝업 골격. 컬렉션/설정 확인 → 유일한 호스트 일치는 무료 선택 → 그 외 기존 API로 자동 추천.
- 추천 등록/처리/적용 동안 컬렉션 선택·저장 잠금. 제목·태그·메모·취소 허용. '저장할 컬렉션을 추천하고 있어요' 표시.
- 입력/컬렉션 버전 재검증 뒤 적용·잠금 해제. AI 추천/사이트 일치 출처 표시, 사용자는 최종 수동 변경/명시적 저장.
- 같은 탭 같은 원본·제목의 유효한 작업 재사용. 등록 통신 재시도는 동일 requestId. 명시적 다시 추천만 신규 ID. 제목 타이핑마다 호출하지 않는다.
- 제목 변경/수동 전환/닫기 뒤 늦은 결과는 덮어쓰지 않는다. 결과 조회 재시도는 읽기만 수행, 불명확한 유료 요청 자동 재발송 금지.
- 키/예산/추천 실패에는 이유와 수동 경로. 30초 지연 시 명시적 수동 전환 허용하되 서버 작업 취소/실패로 가장하지 않는다.
- 저장 중 중복 제출 방지. 서버 성공 후 닫고 북마크 보기 제공. 실패 입력 보존. 태그·메모는 추가 정보로 접기, 모바일 저장 버튼/키보드/안전 영역 보호.

### 낙관적 UI

- 북마크 이동/휴지통/복원, 컬렉션 이름/순서/부모, 관심 주제에 즉시 예상 결과 표시. 기존 서버 응답·재조회로 확정. 실패한 작업만 복구.
- 동일 항목 중복 변경 잠금, 다른 항목 탐색 허용. 컬렉션 구조/관심 주제 버전 변경은 직렬 처리. 전체 캐시 스냅샷 롤백으로 타 작업 성공을 지우지 않는다.
- infinite-query 원본 페이지 길이/offset은 변경하지 않는다. 목록 소속 변경~재조회 완료 동안 추가 로딩 보류.
- 서버 성공 후 조회만 실패하면 성공 변경은 보존하고 최신 조회 실패를 별도 안내.
- 단건 휴지통 이동만 응답 버전으로 실행 취소. 충돌은 최신 상태 안내. 신규 저장/AI 승인/유지 검토/비용은 응답 전에 완료로 표시하지 않는다.
- 컬렉션 삭제/AI 승인/유료 요청의 역연산 실행 취소는 추가하지 않는다.

### 설정·모션

- AI 설정 상태/월 예산 요약 상단. 키 존재는 'AI 설정됨', 실제 연결 검증으로 가장하지 않는다.
- 관심 주제 편집 우선. 이미 등록한 추천 제외, 새 후보 없으면 안내. 비용/예약/요청 수 상시, 차트/표는 상세 사용량으로 접기. 폴링마다 차트 진입 재생 금지.
- 완료 이관 접기, 진행/실패 행동 노출. 작업 기록 초기/빈 상태 구분.
- 선택/행 상태 120–160ms, 트리/패널/Drawer 180–220ms. 전체 목록 순차 등장/반짝임/긴 탄성 금지.
- prefers-reduced-motion: 이동/확대/펄스 제거. 터치 목표 44px, 키보드 초점/복귀 유지.

## Global Constraints

- 기준 576e1f9, 격리 브랜치 codex/bookmark-ux-redesign. 원본 checkout와 실자료 보존.
- 신규 의존성/DB 마이그레이션/오프라인 큐 없음. 소유자/RLS/URL 안전/버전/원본/AI 승인/KST 월 $1 예산 유지.
- 실자료 DB 초기화 및 일반 test:e2e 준비 명령 금지. 기존 localhost:3000/54321 사용, bookmark 전용 config만 사용.
- Node 24.x, 기존 초기 번들 한도와 폼/통계 지연 로딩 유지. push/merge/deploy는 이 실행 범위에 없음.
- 실제 사용자 진입점/변경/새로고침/소유자 DB readback을 최종 근거로 사용. 실패 주입은 보조 회귀 검증.

## Review Focus

1. 재마운트/닫기·재열기/통신 불명확 상황의 중복 유료 추천과 오래된 결과 덮어쓰기.
2. 서로 다른 항목 동시 변경, 서버 성공 뒤 조회 실패, infinite offset/ID 누락.
3. 편집 중 폴링/전환/충돌과 미저장 입력 보호, 패널/Drawer 키보드 초점.
4. 긴 한글·URL·동명·깊은 계층·모바일·200% 확대·reduced-motion.
5. 유지/제안승인/비용/원본/권한 경계를 UI의 낙관적 표시가 약화시키지 않는지.

### Task 1: 시각 기준과 실행 환경

**Interfaces:** Produces standalone design reference, baseline evidence and task ledger. Consumes approved dimensions/tokens/current captures.
- [x] 기존 캡처와 토큰으로 desktop/mobile 및 loading/empty/error/recommending 기준 HTML 작성·캡처.
- [x] Node 24에서 `pnpm exec vitest run bookmark` 실행. Expected: baseline PASS.
- [x] 계획/기준을 범위 커밋하고 결과 기록.

### Task 2: 작업 공간·로딩

**Interfaces:** Consumes existing BookmarkItem/Collection/detail; produces ID selection, reusable detail content, responsive frame and search/load states.
- [x] 실제 UI 회귀에 상세 단일 진입/최신 조회/편집 보호, 검색 IME/디바운스, 초기·추가 로딩 검사를 추가하고 RED 확인.
- [x] 공통 상세와 반응형 패널/Drawer, URL/제목 표시, 검색/로딩/빈 상태 구현.
- [x] `pnpm typecheck` 및 bookmark navigation/manager 회귀 실행. Expected: 해당 동작 PASS.
- [x] 범위 커밋/ledger 기록.

### Task 3: 자동 추천 저장

**Interfaces:** Consumes existing recommend/recommendation/save and shared picker; produces QueryClient-scoped reusable request identity and explicit phase locking.
- [x] 자동 시작/중복 방지/잠금/제목 변경/수동 전환/오류 보존 회귀 RED.
- [x] 즉시 팝업 골격, 자동 추천과 동일 requestId 재사용, 30초 수동 전환, 추가 정보 접기 구현.
- [x] 추천 unit/E2E 및 실제 Main·Quick→추천→저장→DB 확인. Expected: 중복 호출 없이 결과/저장 일치.
- [x] 이전 수동 정책 문서 갱신, 범위 커밋/ledger 기록.

### Task 4: 계층·낙관적 조작

**Interfaces:** Produces per-operation UI overlay and shared mutations used by rows/panel/bulk. Consumes existing versioned command responses; preserves query page lengths.
- [x] 계층 검색/경로·낙관적 표시/동시 실패/offset/실행 취소 RED.
- [x] 공통 변경 처리, 소속 projection, 구조 직렬화, 검색/경로/드롭 구분 구현.
- [x] unit + 실제 이동/휴지통/복원/동시 변경·200개 로딩 회귀와 DB readback. Expected: 보존/정합성 PASS.
- [x] 범위 커밋/ledger 기록.

### Task 5: 설정·작업 기록·모션

**Interfaces:** Consumes existing settings/version/usage ledger/jobs, produces prioritized settings and honest pending states.
- [x] 중복 추천/설정 낙관적 실패/작업 초기 상태 회귀 RED.
- [x] 설정 위계/추천 후보/상세 통계 접기, 작업 로딩, 공통 motion/reduced-motion 구현.
- [x] 설정 UI 변경·새로고침·DB 대조와 responsive/keyboard 검사. Expected: 변경/비용 장부 일치.
- [x] 범위 커밋/ledger 기록.

### Task 6: 통합 검증·디자인 QA·최종 리뷰

**Interfaces:** Consumes complete real UI and reference; produces evidence, design-qa.md and reviewed commits.
- [x] Main/Quick→추천→저장→목록→새로고침→DB, 관리/검토/활동/설정의 실제 흐름 검증.
- [x] 1440x900/1024x768/390x844, light/dark, 200%/keyboard/reduced-motion 확인. 기본 desktop 최소 8행, mobile overflow 없음.
- [x] 같은 viewport/state의 기준/구현을 함께 배치해 디자인 QA. P0/P1/P2 수정 뒤 재캡처. 폰트/간격/색상/자산/문구 모두 확인.
- [x] `pnpm typecheck`, `pnpm verify`, `pnpm exec playwright test --config playwright.bookmarks.config.ts` 실행. Expected: 전체 필수 게이트 PASS, 의도된 외부 opt-in 제외 명시.
- [x] 독립 whole-branch 리뷰, Important/Critical을 회귀 RED→GREEN으로 수정. 실제 결과/제한/판단/잔여 minor 기록.
