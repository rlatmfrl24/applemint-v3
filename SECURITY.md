# 보안 정책

## 지원 브랜치

- 운영 및 보안 지원 기준 브랜치는 `master`입니다.
- `master` 대상 PR은 `CI`, `CodeQL`, `Security Gate`를 통과해야 합니다.

## 취약점 접수

- 의존성 취약점은 GitHub Dependabot Alerts로 관리합니다.
- 코드 취약점은 CodeQL, secret 노출은 GitGuardian 결과를 기준으로 확인합니다.
- 비공개 제보가 필요하면 GitHub의 private security advisory를 사용합니다.

## 차단 정책과 처리 기한

- `critical`·`high`: 허용 기준선 없이 0건을 유지하며, 발견 즉시 PR과 Security Gate를 차단합니다.
- 수집 API 오류: 실제 상태를 확인할 수 없으므로 fail-closed로 차단합니다.
- `medium`: 병합을 차단하지 않지만 14일 안에 수정하거나 위험 수용 근거를 기록합니다.
- `low`·`unknown`: 정기 보안 검토에서 처리 우선순위를 결정합니다.
- 비활성화된 scanner는 실패가 아닌 운영 경고로 보고합니다.

## 기준선과 package override

- `security/alert-baseline.json`은 high/critical이 0건일 때만 생성할 수 있습니다.
- 기준선은 자동 갱신하지 않으며 PR에서 변경 내용을 검토합니다.
- `pnpm.overrides`나 `resolutions`를 추가할 때는 `security/package-overrides.json`에 사유와 제거 조건을 등록해야 합니다.
- override는 최대 90일마다 재검토하며 기한이 지나면 Security Gate가 실패합니다.

## 검증 명령

```powershell
pnpm audit --audit-level high
pnpm security:overrides
pnpm security:gate
pnpm run ci
```

세부 운영 절차와 GitGuardian 판정 원칙은 `docs/SECURITY_OPERATIONS.md`를 따릅니다.
