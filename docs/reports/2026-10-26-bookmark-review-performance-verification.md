# 북마크 검토 조회 개선 검증

## 변경과 보존 계약

승인된 지적 1–4를 `ac505987` 이후 `codex/bookmark-review-performance`에서 구현했다. Browser → owner tRPC → service/repository → Supabase RPC 경계를 유지한다.

- 최신 검사별 상태를 한 번 계산하고 페이지에 검사 JSON을 조인한다. 필터·건수·정렬·구형 검사·raw check 계약을 유지한다.
- 컬렉션 전용 owner RPC로 전체 snapshot 재사용과 무조건적인 10초 폴링을 제거했다. 실제 결과/이관 완료 시 갱신은 유지한다.
- 수락된 검사 INSERT/UPDATE만 `job.progress.healthResultRevision`을 증가시킨다. claim·checkpoint·거절된 과거 관측은 게시하지 않는다. 기존 작업은 보존한 관측 revision 합으로 초기화한다.
- 활성 목록·상세·컬렉션 조회를 취소하지 않고 완료 후 새 결과를 다시 읽는다. 도중의 추가 게시도 합쳐 처리하며 최초 목록의 jobs와 첫 jobs 응답을 비교한다.
- KST 월 **1,000,000,000 nano-dollar($1)**, owner/RLS·lease·북마크 버전·근거 revision 경계와 사용자 직접 유지/휴지통/복원을 보존했다. 자동 삭제는 없다.

## 회귀와 최종 검사

33,000개 북마크·1,500개 검사에서 기존 구현의 실제 상태 함수 호출 수 제한을 RED로 확인했다. 최적화 후 최신 관측당 계산으로 제한된다. fixture는 ANALYZE해 커밋된 운영 데이터의 정상 통계 상태를 맞췄으며, 최초 통계 없는 비교 실행은 취소하고 통과 증거로 사용하지 않았다.

느린 조회 취소·상세 갱신 누락·claim 오탐, 컬렉션 RPC, 게시 revision을 RED→GREEN으로 검증했다. 독립 리뷰의 Important 2건(이관 후 컬렉션·최초 조회 중 게시)을 추가 회귀 검사로 해결했다. 기존 예약 테스트는 실제 KST 09시 이후 실행을 가정해 오전에 실패했으므로, rolled-back transaction 안에서 시계 의존성만 정오로 고정했다. 운영 스케줄러와 08:59/09:00 경계는 바꾸지 않았다.

- Node 24.22.1 / pnpm 10.33.0, `pnpm check` PASS.
- `pnpm verify` PASS: Vitest **1,028개 통과·3개 제외**, pgTAP **908개/41파일**, 생성 타입 일치, production build, 일반 tRPC 경계 133파일 PASS.
- 새 RPC 등록을 위한 `notify pgrst` 한 줄은 전체 검사 후 추가했으며 실제 로컬 REST/화면으로 도달을 확인했다. 업무 로직·생성 타입은 검사한 것과 같다.

## 실제 데이터와 주 흐름

운영에는 DDL/DML을 실행하지 않았다. **33,466개 북마크·1,500개 검사**에서 새 SQL을 읽기 전용으로 분석한 최신 단회 실행은 **3,262ms**였다. 이전 검토의 532ms와 차이가 있어 고정 화면 응답 시간을 보장하는 수치로 쓰지 않는다. 미검사 행의 false 계산만 생략한 기존 의미의 기준 쿼리와 새 쿼리의 전체 JSON이 일치했다(검토 후보 32,592개·첫 페이지 100개). DB 비교는 운영 UI 배포 검증을 대체하지 않는다.

기존 로컬 `supabase_db_applemint-pr-verify-20261015`를 백업하고 additive migration을 CLI로 적용했다. 과거 lookup 함수의 누락 이력은 실제 본문·권한 일치를 확인하고 복구했다. 북마크 **404개** 및 id/URL/title/state/saved_at digest **5185da946d530dd7738398e7de4d2f71**가 전후 일치한다. 기존 DB reset은 하지 않았다.

기존 로컬 owner 세션으로 실제 검토 화면의 **376개 후보**, 죽은 링크 필터 **10개/10개**, 상세의 HTTP 404·재확인 근거를 확인했다. 로컬 표본은 운영 전체와 다르며 대규모 회귀와 별도로 구분한다. 새 유료 AI 호출이나 북마크 유지·이동·삭제는 실행하지 않았다.

운영 마이그레이션·배포, 운영 브라우저의 최종 체감/동시 부하는 미확인이다. 백업·로그·화면은 ignored `reports/bookmark-review-performance/`에 보존한다. 원본 root의 미추적 승인 문서를 보존했다.
