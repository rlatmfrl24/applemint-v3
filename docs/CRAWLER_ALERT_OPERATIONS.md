# 크롤러 장애 알림 운영 가이드

Applemint는 `crawl_runs`를 15분 간격으로 평가하고, 소스별 장애 에피소드 하나당 GitHub Issue 하나를 유지합니다. 같은 장애가 지속되면 24시간 후 댓글로 다시 알리고, 모든 신호가 정상화되면 복구 댓글과 함께 Issue를 종료합니다.

## 감지 기준

- parser failure 2회 연속
- parser 유효 건수가 최소 기준의 50% 미만인 실행 2회 연속
- 실행 이력이 있는 소스에서 48시간 동안 `succeeded` 또는 `partial` 실행 없음
- 최근 3회 실행의 HTTP·network·timeout 오류율이 50% 이상이고 오류가 2건 이상

전송 오류는 최근 2회가 모두 정상일 때 복구로 판정합니다. Parser failure는 최근 실행이 정상일 때, 추출량 급감은 최근 실행이 최소 기준 이상일 때 복구됩니다.

## GitHub 설정

Repository **Settings > Secrets and variables > Actions**에서 다음 값을 등록합니다.

- Variable `SUPABASE_URL`: 연결된 Supabase 프로젝트 URL
- Secret `SUPABASE_SERVICE_ROLE_KEY`: Supabase 서버 전용 service role key

Issue 생성에는 별도 PAT를 사용하지 않고 workflow의 `GITHUB_TOKEN`과 `issues: write` 최소 권한만 사용합니다. service role key를 명령 인자, 로그, Issue 또는 문서에 입력하지 않습니다.

`.github/workflows/crawler-health.yml`은 매시 7·22·37·52분에 실행됩니다. GitHub Actions 예약 실행은 부하에 따라 지연될 수 있으므로 15분은 목표 감지 주기입니다.

## 배포와 첫 확인

1. `supabase db push`로 alert migration을 먼저 적용합니다.
2. Next 애플리케이션을 배포합니다.
3. GitHub variable과 secret을 등록합니다.
4. `crawler-health.yml`이 포함된 변경을 `master`에 반영합니다.
5. Actions의 **Crawler Health > Run workflow**에서 `delivery_test`를 선택해 실행합니다.
6. `[Crawler Monitor Test] 알림 전달 확인` Issue가 생성되고 댓글 작성 후 자동 종료됐는지 확인합니다.
7. `delivery_test` 없이 한 번 더 실행하고 정상 종료되는지 확인합니다.

## 장애 대응

- Issue에는 source, 안전한 집계, 실행 ID만 표시됩니다. 실제 오류 상세는 Applemint 설정 화면의 실행 이력에서 확인합니다.
- `parser-failure` 또는 `parser-volume-drop`이면 실제 응답 구조를 확인하고 fixture와 parser 테스트를 먼저 갱신합니다.
- `transport-error-rate`이면 대상 사이트 HTTP 상태, TLS 및 timeout을 확인하며 인증서 검증을 우회하지 않습니다.
- `no-recent-success`이면 마지막 실행 시각과 예약/수동 실행 여부부터 확인합니다.
- Supabase 조회 자체가 실패하면 `[Crawler Monitor] 상태 확인 실패` Issue 하나가 유지되며 연결 복구 후 자동 종료됩니다.

Issue 전달이 실패해도 DB outbox는 삭제되지 않습니다. 다음 workflow가 같은 incident marker를 검색해 중복 Issue 없이 재시도합니다.
