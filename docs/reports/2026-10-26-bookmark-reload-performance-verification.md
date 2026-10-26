# 북마크 처리 후 목록 재조회 안정화 검증

기준은 PR #196 병합 commit `aca6dac223413ebf64b6e002b40f8026b1c1e72f`다. 월 $1 AI 한도, 자동 검사 일정·검사량, 자동 삭제 없는 흐름과 소유자·최신 근거 검증은 유지한다.

## 확인한 원인

운영 Supabase 로그에서 2026-10-26 12:50~12:53 KST 사이 `bookmark_snapshot` SELECT의 `57014: canceling statement due to statement timeout`이 100회 발생했다. 인증 역할의 statement timeout은 8초다. 북마크 변경은 성공했으나 후속 조회는 실패하는 증상과 일치한다.

처리 후 갱신이 `refetchType: all`을 사용해 이전에 방문한 비활성 목록·상세까지 다시 읽었다. 실제 TanStack Query observer와 캐시를 사용한 회귀에서 비활성 필터의 조회 실패만으로 현재 화면의 재조회도 실패하는 것을 RED로 확인했다. 활성 화면만 재조회하고, 성공 후 비활성 캐시를 제거해 유지된 항목의 재등장을 방지한다. 화면 전환으로 기존 조회가 취소되고 새 화면이 아직 로딩 중이면 승인된 낙관적 표시를 해제하지 않는다. 해당 취소 회귀도 RED→GREEN으로 확인했다.

DB는 검토가 아닌 일반 목록·상세에서도 전체 최신 검사에 대한 판별과 JSON 직렬화를 수행했다. 33,000개 북마크·1,500개 검사 회귀에서 일반 목록 및 상세가 각각 불필요한 판별 함수를 6,000번 호출하는 것을 RED로 확인했다. 새 migration은 검토에서만 판별하고, 검사 원본 JSON과 중복 개수는 실제 페이지 항목에 대해서만 구성한다. 보관 정리에만 전체 중복·유지 집계를 사용한다. 검사 근거가 필요한 검토 범위는 해당 최신 검사 ID로 북마크를 좁힌다. 함수 내부의 요청별 계획을 사용해 필터별 인덱스 경로가 generic plan으로 대체되지 않도록 한다. 소유자 체크·함수 실행 권한·분류 조건·정렬·버전/URL 검증·응답 구조는 보존한다.

운영 데이터에 쓰지 않는 단독 RPC 측정은 확인 필요 범위 100개 조회에 3,208ms였다. 읽기 전용 실행 계획에서 기존 전개 쿼리는 2.7~4.1초 및 전체 북마크 순차 스캔·중복 집계를 보였다. 최종 개선 쿼리는 같은 운영 데이터에서 약 1,000ms이며, 대상 1,570개를 기본 키로 읽고 페이지 중복 개수는 URL 인덱스로 읽었다. 이 비교는 DB 진단 측정이며 배포 후 HTTP 전체 지연이나 장기 부하의 보장은 아니다.

## 검증

- `pnpm check`: PASS. Node 24.19.0, Biome·Knip·타입 검사. 기존 무관한 useTemplate 정보 1건은 보존했다.
- 최종 제품 코드의 전체 Vitest: 1,050개 PASS, 기존 3개 제외. 생성 DB 타입 drift 검사도 PASS.
- 전체 pgTAP: 936개/43파일 PASS. 새 일반/상세 판별 비용 회귀와 기존 reviewGroup·레거시 API·필터·건수·페이지·중복·소유자·월 예산 검증을 포함한다.
- production build, tRPC 서버 경계 133파일, client bundle 제한 PASS.
- 실제 로컬 owner 로그인 UI Playwright: 5/5 PASS. 여러 범위의 캐시를 만든 뒤 유지 → 현재 목록 1회 재조회 → 수동 새로고침 → 페이지 재진입을 확인했다. 비활성 필터 실패를 주입해도 해당 필터 요청 자체가 발생하지 않았다. 제목 근거 상세, 삭제·실행 취소, 컬렉션 승인과 DB readback, 375/972/1440px 및 결과 게시 중 다중 페이지·선택·스크롤 보존도 확인했다.
- 검증 전후 로컬 북마크 404개·AI 예약 62개 동일. fixture 전용 131개 항목은 정리됐으며 추가 유료 AI 호출과 DB reset은 하지 않았다. 기존 3000번 서버는 유지하고 새 checkout을 3001번에서 실행했다. 검증 설정은 해당 loopback 서버와 기존 로컬 DB만 가리킨다.

첫 `pnpm verify`는 스케줄 테스트 43번에서 실패했다. 해당 테스트는 enqueue의 시계만 정오에 고정했으나 commit은 실제 시계를 사용해, 오후 실행에서는 정오+90초의 가짜 lease가 이미 만료됐다. 생산 코드 대신 fixture의 lease만 실제 transaction clock+90초로 수정했다. 그 뒤 실패한 전체 DB 검사와 아직 도달하지 않았던 build를 완료하고 앞선 타입·단위 검증을 재사용한 **조합 검증**이다. 실패한 전체 명령을 재실행해 통과했다고 표현하지 않는다.

## 운영 반영과 정리

추가 migration `20261026041145_bookmark_snapshot_loading_performance.sql` 1개를 UI 배포보다 먼저 적용해야 한다. 기존 raw check·북마크·예산 장부·판정기·자동 검사 설정은 변경하지 않는다. 이 기록 시점에는 로컬에만 적용했고 운영은 읽기 전용으로 조사했다.

PR #196의 정확한 squash head와 merge commit·tree를 확인해 primary master를 fast-forward했다. 관련 local branch와 worktree 등록을 제거하고 managed archive를 보존했다. ignored 증거·진행 기록·로컬 인증 파일 101개를 primary checkout의 ignored `reports/pr196-closeout/`에 복사하고 해시를 검증했다. 다른 활성 작업은 보존했다. 현재 수정은 별도 `codex/bookmark-loading-timeout` worktree에서 수행한다. 이전 worktree 경로는 내용이 비워졌지만 런타임의 디렉터리 잠금이 남아 있어 종료 후 실제 경로 부재를 다시 확인한다.
