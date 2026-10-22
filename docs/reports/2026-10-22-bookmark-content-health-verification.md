# 북마크 본문·미디어 점검 검증

2026-10-22. Native 구현. 브랜치 `codex/bookmark-content-health`, 기준 `fefac202573d37cc4bd00ce08b97a7b273be0d10`. 자동 삭제 없음, 기존 월 $1 예산 유지. 운영 migration·배포·push 없음.

## 자동 검증

최종 코드 artifact는 `5cec6aa74e6f4295c5fe2da89df49d898384e9b0`다. Node 24.22.1/pnpm 10.33.0에서 `pnpm check`와 `pnpm verify`를 통과했다. Vitest 1,022개 통과·선택 네트워크 등 3개 제외(134파일 통과/1파일 제외), pgTAP 893개/38파일 통과, 격리 DB 전체 migration 재생·생성 타입 일치·빌드·tRPC 경계 133파일 통과다. Coverage는 statements 74.27%, branches 66.82%, functions 73.02%, lines 75.52%이며 Main gzip 127.1 KiB로 기존 한도를 지켰다. 별도의 수동 저장 검증에서는 실제 `processHealthClaim`이 만든 최대 미디어 근거를 격리 DB의 `bookmark_worker_commit` RPC에 전달해 저장에 성공했고 transaction은 rollback했다. 이 일회성 검증 파일은 배포할 테스트 집합에서 제외한 뒤 전체 verify를 다시 통과했다.

초기 RED 후 GREEN을 확인한 항목은 계약/필터, 본문·미디어 추출, charset/압축/SSRF/크기 상한, Jev 확률/사용량 검증, 단계 재개, 비용 불명확·월 경계·늦은 영수증, 소유자 설정/중복 시작, UI 근거 revision이다. 실자료에서 HTTP→HTTPS 같은 호스트 이동이 반복 대기하는 원인을 발견해 이동 URL/깊이를 저장하도록 수정했다. 미완료/의심 관측이 이전 정상 미디어 기준을 바꾸는 SQL 회귀 2개도 RED→GREEN으로 보강했다. 테스트는 기존 접속 의미나 권한/예산을 완화하지 않았다.

## 실제 경로와 자료

현재 로컬 연결은 `supabase_db_applemint-pr-verify-20261015`였으며 대부분 example.com 자료였다. 이 자료를 실자료 결과로 세지 않았다. 연결된 Applemint Supabase에서 실제 기존 북마크 30개/30도메인을 읽기 전용으로 조회해 제목·URL·저장일·ID만 로컬 DB에 복사했다. 모호한 페이지의 실제 Jev 영수증과 일반 문서 동작을 확인하려고 20개와 7개를 추가해 총 57개를 검사했다. 추가 표본은 목적을 갖고 고른 자료이므로 무작위 정확도 표본이 아니다. 원본 Supabase에는 SELECT만 실행했다. 전체 로컬 DB를 `reports/bookmark-health-before-20261022.dump`로 백업한 뒤 추가 migration만 적용했으며 reset하지 않았다.

검증 서버는 `http://localhost:3001`의 기존 owner 로그인이다. 사용 중이던 3000 서버를 유지했다. 로컬 worker Vault 주소만 검증 서버로 연결했으며 원래 주소를 보존했다. 실제 UI의 체크박스 선택 → 링크 검사 → owner tRPC → DB 작업 → 기존 cron/인증된 worker → 실제 URL/OpenRouter → DB 근거/영수증 → UI 필터/상세 흐름을 사용했다. 테스트 harness나 직접 enqueue/worker SQL 호출로 주 흐름을 대체하지 않았다.

- 최초 수동 작업 `f4cad406-15a0-4bbe-a5e0-5382e5acecd5`: UI에서 실제 30개 선택, 새 검사 30개·재사용 0개 표시 확인.
- 추가 수동 작업 `3f74a91b-237d-46de-af2f-742b8579e819`: 실제 20개 선택, 새 검사 20개 표시 확인.
- 추가 수동 작업 3개는 각각 3/3, 2/2, 2/2개 완료했다. GeekNews의 일반 문서는 유료 AI 없이 본문을 확인했고, Pgr21의 구형 문서는 실제 Jev 판정/정산까지 진행했다.
- 설정 UI에서 enabled=true/dailyLimit=500 저장 후 owner readback 확인. 기존 cron이 자동 작업 `993a5349-c836-4ee4-9426-799e60c7592e`, automaticDate=2026-10-22, 대상 346개를 등록했다. 수동 30개의 진행분을 재사용/제외했으며 새 cron을 만들지 않았다. 실제 자동 worker가 7개 관측을 저장하고 5개를 완료했다. 자동 후보의 기존 예제 자료는 실자료 정확도 측정에서 제외했다.
- 이후 Settings에서 자동 점검을 껐으며 enabled=false/dailyLimit=500, 자동 관측 7개 보존을 DB로 확인했다. 자동 등록뿐 아니라 수집·비활성화의 주 경로도 관측했다.

## 직접 정리

Tonematrix를 실제 원문 열기 버튼으로 열어 JS 기반 화면을 확인했다. HTTP 200이지만 본문/미디어 판단 불가, 제한된 범위, AI unknown(신뢰 점수 79%)이라는 상세를 확인했다. 유지 후 접근 제한·판단 불가 필터에서 항목이 빠지는 것과 25→24개 count를 확인했다. 이어 실제 UI로 휴지통 이동·휴지통 화면에서 복원했다. DB readback은 library/version=3, open_count=1, keep/open/trash/restore 이벤트 각 1개이며 제목·URL·2013-03-30 저장일을 보존했다. 원본 Supabase 북마크는 변경하지 않았다.

## 관측된 효율과 품질

실제 북마크의 Jev 영수증 10건은 모두 settled, 합계 398,790 nano-dollar(`$0.000398790`)이며 비용 불명확 예약은 없다. 자동 검사에 섞인 예제 자료의 실제 모델 호출 1건은 별도로 34,566 nano-dollar다. 신규 health 호출 전체 비용은 `$0.000433356`; UI의 월 합계 약 `$0.008040`에는 기존 로컬 검증 ledger가 포함되므로 이 기능의 실제 사용 비용으로 오인하면 안 된다. 공유 월 `$1` 한도는 바꾸지 않았다.

최초 30개 관측의 분포는 다음과 같다. 진행 중 미디어 관측도 포함하며 후보 필터의 최종 건수와는 다르다.

| 축 | 관측 |
| --- | --- |
| 접속 | healthy 21, dead 3, temporary 3, restricted 3 |
| 본문 | present 4, unknown 15, restricted 2, not_checked 9 |
| 미디어 | present 1, none_detected 1, unknown 18, not_checked 10 |
| AI 호출률 | 4/30, 13.3% |

본문 unknown 비율 50%, 미디어 unknown 비율 60%다. Jev 대상 10건 중 9건은 unknown, 1건은 restricted였다. 후자는 실제 브라우저에서 글 본문을 볼 수 있었으므로 권한 제한 판정을 확정 사실로 삼을 수 없다. 구형 HTML·JS·잘린 문서에서 AI만 추가한다고 본문/미디어 판정이 해결되지는 않았다. 이 결과를 정상·삭제 판정 정확도로 표현하지 않는다.

최초 HTTP dead 후보 3개를 직접 브라우저로 대조했다. 루리웹은 삭제 안내, Sakura는 404, Tistory는 권한 또는 존재하지 않는 페이지 안내였다. 모두 비로그인 원문 열람이 불가능했으나 Tistory의 정확한 원인은 구분하지 못했다. Silk/Tonematrix의 대화형 화면, D2/GeekNews/Pgr21의 실제 본문, Sina의 작성자 로그인 제한도 대조했다. 모바일 Naver Blog 직접 열기는 브라우저 사이트 안전 정책에 차단되어 우회하지 않았다. 실제 미디어 삭제의 확정 정답 표본과 전체 정상 자료의 정답 라벨이 없으므로 삭제 오탐률·미디어 후보 적중률은 계산하지 않았다.

최초 30개의 최초 본문 관측까지 중앙값은 약 8.94분, 마지막 최초 관측은 약 28.94분이었다. 이는 수동/자동 작업이 함께 있던 로컬 cron과 호스트 대기 환경의 관측값이며 최종 완료 시간 또는 500개/일 처리량이 아니다. 실측 중 짧은 호스트 대기가 다음 분 cron까지 늘어나는 문제를 보완해, 다른 ready 작업이 없을 때만 기존 worker의 20초 범위에서 알려진 짧은 retryAt을 기다리게 했다. 20 claim·20초·호스트 제한·AI 호출 후 종료·긴 예산/재확인 대기는 유지했다. 배포 규모의 wire 전송량과 500개/일 지속 처리량은 미측정이다.

24시간 뒤 본문·미디어 재확인은 실제 시간이 지나지 않아 SQL/단위 검증과 예약 시각 readback까지 확인했다. HTTP 1분 재확인은 실제 dead 3건의 repeated 상태를 확인했다. 미디어 응답 확인은 삭제 대체 이미지의 의미나 동영상 전체 재생 확인을 보장하지 않는다.

## 최종 리뷰와 수정

독립 reviewer 한 명이 `1afbeb3c34adee78e04293988feb448c3aa091ac` 전체 변경과 ledger를 검토했다. Critical 없음, Important 3건(구조화된 로딩/권한/삭제 화면의 정상 오판정, compact JSON과 PostgreSQL byte 크기 차이, 수정 후 Resume의 오래된 checkpoint), Minor 1건(활성화 전 외부 AI 전송 안내)이었다. 마지막 항목은 실제 활성화 시의 정보 제공이므로 Important로 재평가했다.

네 항목 모두 RED→GREEN으로 수정했다. 실제 8,442-byte PostgreSQL 근거의 초과 재현, owner edit→stale commit→owner Resume→새 checkpoint→현재 version 근거 저장의 SQL 실패 3개를 확인한 뒤 통과했다. 예약 기록은 유지한다. 실측에서 발견한 짧은 대기 처리도 RED→GREEN으로 보완했으며 다른 ready 작업을 먼저 처리한 뒤 만료된 대기 시각을 버리는 경우와 24시간 대기를 포함한다. 수정 뒤 별도 재리뷰를 호출하지 않고 전체 검증을 다시 수행했다. 리뷰에서 판단을 거절한 범위는 없고, 테스트가 요구 계약을 바꾸거나 주 흐름을 대체한 부분도 없다.

보류한 경미한 항목: 자동 점검을 끈 뒤 남은 retry 작업이 있으면 기존 dispatch가 분당 빈 인증 worker 호출을 할 수 있다. 실제 신규 자동 claim·모델 호출은 중단한다. 영향은 낮으며 후속 정리는 dispatch의 eligible 조건을 claim과 맞추는 변경이다.

## 운영 적용과 로컬 정리

추가 migration 5개를 기존 순서대로 적용해야 한다. 자동 설정 초기값은 false/500이며 Settings에서 활성화해야 한다. 기존 cron·Vault 주소/내부 인증·OpenRouter 키를 사용하고 신규 cron이나 공급자를 만들지 않는다. 운영 migration·push·PR·병합·배포는 수행하지 않았다.

13:53 KST 최종 관측에서 실제 수동 57개 중 56개가 완료됐고 최초 30개 중 1개는 미디어 호스트의 backoff로 14:06 이후 재시도를 기다렸다. 57개 모두 library에 있으며 제목·URL·저장일이 읽기 전용 원본과 일치한다. 완료되지 않은 관측을 성공으로 정규화하지 않았다.

검증 종료 후 만든 대기 작업 2개만 pause했다(수동 29/30, 자동 5/346). 원래 로컬 Vault 주소를 복구하고 소유한 3001 서버를 종료해 기존 3000 서버가 새 checkpoint를 구형 방식으로 소비하지 않게 했다. 근거 64개·health 영수증 11개 보존, 자동 false/500, Vault 복구를 권위 DB로 확인했다. 해당 로컬 검증 작업을 이어 보려면 갱신한 앱을 시작한 뒤 같은 작업을 재개해야 한다. 사용하던 3000 서버와 원본 checkout은 유지했다.

증거 파일(로컬 ignored): Settings/상세 PNG, `bookmark-health-final-readback-20261022.json`, `bookmark-health-browser-labels-20261022.json`, 읽기 전용 원본 목록 3개 JSON, 전체 DB 백업. 앱 비밀키와 원본 URL query는 이 보고서에 싣지 않는다.
