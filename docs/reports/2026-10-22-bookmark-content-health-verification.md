# 북마크 본문·미디어 점검 검증

2026-10-22. Native 구현. 브랜치 `codex/bookmark-content-health`, 기준 `fefac202573d37cc4bd00ce08b97a7b273be0d10`. 자동 삭제 없음, 기존 월 $1 예산 유지. 운영 migration·배포·push 없음.

## 자동 검증

`pnpm verify` PASS: Node 24.22.1, Vitest 1,014개 통과·선택 네트워크 등 3개 제외, pgTAP 881개/37파일 통과, 새 격리 DB의 migration 전체 재생·생성 타입 일치·빌드·tRPC 경계 133파일 통과. 전체 coverage statements 74.07%, branches 66.43%, functions 72.94%, lines 75.36%. Main gzip 127.1 KiB로 기존 한도를 지켰다. `pnpm check`의 최종 재확인은 보고서 확정 시 기록한다.

초기 RED 후 GREEN을 확인한 항목은 계약/필터, 본문·미디어 추출, charset/압축/SSRF/크기 상한, Jev 확률/사용량 검증, 단계 재개, 비용 불명확·월 경계·늦은 영수증, 소유자 설정/중복 시작, UI 근거 revision이다. 실자료에서 HTTP→HTTPS 같은 호스트 이동이 반복 대기하는 원인을 발견해 이동 URL/깊이를 저장하도록 수정했다. 미완료/의심 관측이 이전 정상 미디어 기준을 바꾸는 SQL 회귀 2개도 RED→GREEN으로 보강했다. 테스트는 기존 접속 의미나 권한/예산을 완화하지 않았다.

## 실제 경로와 자료

현재 로컬 연결은 `supabase_db_applemint-pr-verify-20261015`였으며 대부분 example.com 자료였다. 이 자료를 실자료 결과로 세지 않았다. 연결된 Applemint Supabase에서 실제 기존 북마크 30개/30도메인을 읽기 전용으로 조회해 제목·URL·저장일·ID만 로컬 DB에 복사했다. 모호한 페이지의 실제 Jev 영수증 검증을 위해 기존 실제 북마크 20개를 추가 복사했다. 원본 Supabase에는 SELECT만 실행했다. 전체 로컬 DB를 `reports/bookmark-health-before-20261022.dump`로 백업한 뒤 추가 migration만 적용했으며 reset하지 않았다.

검증 서버는 `http://localhost:3001`의 기존 owner 로그인이다. 사용 중이던 3000 서버를 유지했다. 로컬 worker Vault 주소만 검증 서버로 연결했으며 원래 주소를 보존했다. 실제 UI의 체크박스 선택 → 링크 검사 → owner tRPC → DB 작업 → 기존 cron/인증된 worker → 실제 URL/OpenRouter → DB 근거/영수증 → UI 필터/상세 흐름을 사용했다. 테스트 harness나 직접 enqueue/worker SQL 호출로 주 흐름을 대체하지 않았다.

- 최초 수동 작업 `f4cad406-15a0-4bbe-a5e0-5382e5acecd5`: UI에서 실제 30개 선택, 새 검사 30개·재사용 0개 표시 확인.
- 추가 수동 작업 `3f74a91b-237d-46de-af2f-742b8579e819`: 실제 20개 선택, 새 검사 20개 표시 확인.
- 설정 UI에서 enabled=true/dailyLimit=500 저장 후 owner readback 확인. 기존 cron이 자동 작업 `993a5349-c836-4ee4-9426-799e60c7592e`, automaticDate=2026-10-22, 대상 346개를 등록했다. 수동 30개의 진행분을 재사용/제외했으며 새 cron을 만들지 않았다. 자동 작업의 실제 수집은 사용자 작업 우선순위에 따라 대기 중이다. 자동 후보에 포함된 기존 예제 자료는 실자료 정확도 측정에서 제외한다.

## 직접 정리

Tonematrix를 실제 원문 열기 버튼으로 열어 JS 기반 화면을 확인했다. HTTP 200이지만 본문/미디어 판단 불가, 제한된 범위, AI unknown(신뢰 점수 79%)이라는 상세를 확인했다. 유지 후 접근 제한·판단 불가 필터에서 항목이 빠지는 것과 25→24개 count를 확인했다. 이어 실제 UI로 휴지통 이동·휴지통 화면에서 복원했다. DB readback은 library/version=3, open_count=1, keep/open/trash/restore 이벤트 각 1개이며 제목·URL·2013-03-30 저장일을 보존했다. 원본 Supabase 북마크는 변경하지 않았다.

## 관측과 남은 검증

진행 중 기록이다. 실제 완료/대기 수, 최종 Jev 영수증 수·비용, 자동 worker 수집 결과 및 독립 리뷰 결과는 확정 후 갱신한다. 24시간 뒤 본문·미디어 재확인은 실제 시간이 지나지 않아 SQL/단위 검증과 예약 시각 readback까지만 확인할 수 있다. HTTP 1분 재확인은 실자료에서 repeated 상태를 확인했다.

삭제된 원문/DNS 실패, 접근 제한, JS/일부 추출의 unknown은 실제로 관측했다. 실제 미디어 삭제의 확정 정답 표본은 아직 확보하지 않았으므로 오탐률/적중률을 주장하지 않는다. 정상·의심·unknown과 AI 호출률은 해당 표본의 관측값이며 전체 3만여 북마크 정확도 보장이 아니다. wire 전송량과 500개/일 지속 처리량은 실측하지 않았다. 미디어 응답 확인은 사진의 의미나 동영상 전체 재생 확인을 보장하지 않는다.

증거 파일(로컬 ignored): `reports/bookmark-health-settings-20261022.png`, `reports/bookmark-health-detail-20261022.png`, 실제 읽기 전용 원본 목록 2개 JSON. 예약/근거의 원본 URL query나 앱 비밀키를 보고서에 기재하지 않는다.
