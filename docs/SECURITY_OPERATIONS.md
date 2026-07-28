# 보안 경고 운영 절차

## 1. Dependabot·CodeQL 처리

1. `critical`·`high` 경고는 배포와 병합을 중단하고 패치 버전과 영향 경로를 확인합니다.
2. 직접 의존성을 우선 갱신하고, 전이 의존성 override는 상위 패키지 갱신이 불가능할 때만 사용합니다.
3. `pnpm why <package>`와 `pnpm audit --audit-level high`로 취약 경로가 사라졌는지 확인합니다.
4. `pnpm verify`와 사용자가 수행하는 운영 smoke 확인이 끝난 후 master에 반영합니다. 자동화에서는 smoke와 Playwright E2E를 실행하지 않습니다.
5. GitHub alert가 종료된 것을 확인한 뒤 중복 Dependabot PR을 superseded로 닫습니다.

medium 경고는 14일 안에 수정하거나, 기준선 PR에 영향 범위와 위험 수용 근거를 남깁니다. 기준선은 경고를 숨기지 않으며 신규·해결 경고를 비교하기 위한 기록입니다.

## 2. GitGuardian 판정 원칙

다음 값은 실제 사용 여부가 불확실해도 먼저 true positive로 취급합니다.

- Supabase service role key, anon key, JWT signing secret
- `CRAWL_INTERNAL_SECRET`, `VAPID_PRIVATE_KEY`, API key, OAuth client secret
- 운영 DB 비밀번호나 실제 로그인 비밀번호
- 외부 서비스에서 인증 수단으로 사용할 수 있는 고엔트로피 문자열

실제 secret이면 노출 범위를 확인한 뒤 새 값 발급, 환경변수 교체, 재배포, 기존 값 폐기 순서로 회전합니다. 이후 Supabase·Vercel·GitHub·외부 서비스 로그를 확인하고 incident를 해결합니다. 파일에서 문자열만 삭제한 것으로 처리를 끝내지 않습니다.

다음 값은 인증 수단이 아님을 확인한 경우에만 false positive로 처리할 수 있습니다.

- migration과 RLS 테스트에 고정된 Supabase Auth 사용자 UUID
- `127.0.0.1` 또는 local Supabase에만 연결되는 명백한 테스트 비밀번호
- 공개 문서에 이미 노출된 식별자나 재현용 placeholder

false positive 처리 기록에는 detector, 파일과 줄, commit, 인증에 사용할 수 없는 이유, 확인자, 처리일을 남깁니다. GitGuardian Dashboard에서 개별 incident 또는 정확한 fingerprint만 제외하며 migration 전체, test 폴더 전체, detector 전체를 허용 목록에 넣지 않습니다.

## 3. 기준선 갱신

GitHub Actions의 live alert 수집에는 저장소 Actions secret `SECURITY_ALERTS_TOKEN`을 사용합니다. 이 값은 Applemint 저장소만 접근하는 fine-grained PAT로 만들고 Dependabot alerts, Code scanning alerts, Secret scanning alerts의 읽기 권한만 부여합니다. 만료 전에 새 토큰으로 교체하며 workflow나 로그에 값을 출력하지 않습니다.

```powershell
pnpm security:collect-alerts
pnpm security:baseline
git diff -- security/alert-baseline.json
pnpm security:gate
```

- `security:baseline`이 high/critical 때문에 실패하면 예외를 추가하지 않고 취약점을 먼저 수정합니다.
- resolved alert 삭제와 신규 medium/low 추가를 PR diff에서 각각 확인합니다.
- scanner 수집 오류나 권한 오류 상태에서는 기준선을 갱신하지 않습니다.

## 4. Package override 검토

override가 꼭 필요한 경우 `security/package-overrides.json`에 다음을 기록합니다.

- manager와 selector, 강제 버전
- 도입 이유와 도입일
- 마지막 검토일과 90일 이내의 다음 검토일
- 상위 패키지 갱신 등 구체적인 제거 조건

검토 시 override를 제거한 상태로 lockfile을 다시 계산하고 audit와 `pnpm verify`를 실행합니다. 안전 버전이 자연스럽게 선택되면 override와 등록 내역을 함께 삭제합니다.
