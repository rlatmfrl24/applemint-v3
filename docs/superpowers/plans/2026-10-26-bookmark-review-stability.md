# 북마크 화면 정리 및 검토 목록 안정화 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for Native execution. The accepted specification is the user's implementation request in this chat.

**Goal:** 불필요한 UI를 제거하고 구체적인 실패 근거가 있는 링크를 기본으로 표시하며 새 결과는 사용자가 반영한다.
**Architecture:** owner tRPC → service/repository → 집합 기반 Supabase snapshot을 유지한다. 선택적 reviewGroup으로 구형 API의 의미를 보존하고 작업 게시 감지와 목록 반영을 분리한다.
**Tech Stack:** Next.js 16.4.2, React 19, TanStack Query 5, Supabase/PostgreSQL, Vitest, Playwright.

## Global Constraints

- KST 월 $1(1,000,000,000 nano-dollar), 검사 일정·검사량, 자동 삭제 없는 사용자 직접 정리를 유지한다.
- 현재 버전·URL·미검토 검사만 사용한다. 문제 링크는 재확인 repeated인 404/410/NXDOMAIN, complete 본문 삭제·변경, missing>0 미디어 누락이다.
- reviewGroup 생략 시 기존 API 의미를 유지한다. UI 기본은 problems이며 attention/organize/classify를 별도로 제공한다.
- 새 결과 보기·수동 새로고침은 첫 100개를 조회한 뒤 성공 시 교체·스크롤/선택 초기화한다. 실패 시 화면을 보존한다.
- 유지·삭제·복원·제안 승인 후 기존 정합성 재조회, optimistic rollback, undo, evidence revision 검증은 보존한다.

## Review Focus

- 최초 목록 조회 도중 및 수동 반영 도중 게시된 결과를 놓치지 않는다.
- 이전 그룹의 느린 응답은 새 그룹의 목록·선택·스크롤을 변경하지 않는다.
- 열람 기록의 늦은 응답이 더 최신 열람 횟수·revision을 되돌리지 않는다.
- 구형 링크와 숨겨진 search 조건을 안전하게 정규화한다.
- 상세 진입·변경안 승인·모바일 조작은 근거 버튼 제거 후에도 자연스럽게 접근 가능하다.

## Task 1: 분류 계약과 DB 조회

- [x] 선택적 reviewGroup(problems/attention/organize/classify)와 실패 근거·건수·페이지·legacy·owner 경계를 검증하는 회귀를 먼저 실행해 RED를 확인한다.
- [x] 신규 additive migration 하나에 집합 기반 그룹 조건을 추가한다. 기존 private matcher와 legacy API 의미는 유지한다.
- [x] SQL 회귀를 GREEN으로 확인한다. 문제 유형의 교집합은 중복 행을 생성하지 않는다.

## Task 2: 새 결과 알림과 목록 갱신

- [x] 게시 이벤트·초기 race·첫 페이지 반영·실패 보존·필터 전환 race·열람 캐시 회귀를 RED로 확인한다.
- [x] 결과 게시 시 목록 invalidate를 제거하고 snapshot jobs와 최신 jobs 비교로 새 결과 버튼을 표시한다.
- [x] 수동 반영 성공 시 infinite cache를 첫 페이지로 교체한다. focus/reconnect 자동 목록 조회는 끈다.
- [x] jobs 폴링은 activity 5초, 기타 진행 작업 있음 15초/없음 60초, background false다.
- [x] 행·상세 열람은 공용 hook에서 authoritative open_count/opened_at/review_revision만 캐시에 병합한다.
- [x] 관련 Vitest 회귀를 GREEN으로 확인한다.

## Task 3: 주석 기반 UI 정리

- [x] 제목 옆 북마크/검토 탭; 우측 부가 문구·작업 기록 링크 제거(설정 진입 유지).
- [x] 사이드바 컬렉션 검색과 검토 검색만 제거한다. dialog 검색은 유지한다.
- [x] 그룹 선택창과 problems 전용 전체/죽은 링크/본문 문제/미디어 문제 필터를 제공한다.
- [x] 설명 문장·목록 갱신 중 행·근거 버튼을 제거한다. 변경안 버튼과 제목의 상세 진입을 유지한다.
- [x] 툴바 간격 8px, 고정 상태 공간, 반응형 헤더·터치·키보드를 검증한다.

## Task 4: 실제 흐름과 최종 검증

- [x] 로그인한 로컬 UI에서 실제 owner tRPC와 DB로 조회·분류·유지/삭제/실행 취소·상세·변경안을 확인한다.
- [x] 375/972/1440px와 다중 페이지, 게시 중 조작 안정성, 느린/실패 조회를 Playwright로 검증한다.
- [x] pnpm check, pnpm verify, 관련 Playwright를 수행한다. 유료 AI 호출은 추가하지 않는다.
- [x] fresh whole-branch reviewer로 최종 검토하고 필요한 회귀·수정을 완료한다.
- [x] 마이그레이션 → UI 순서의 배포 조건과 실제 완료/미확인 범위를 기록한다. merge/push/운영 배포는 현재 구현 요청만으로 수행하지 않는다.
