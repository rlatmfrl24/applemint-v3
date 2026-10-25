# 보안 실패 원인 확인 및 의존성 수정

기준 브랜치는 `codex/bookmark-review-performance`, 수정 전 커밋은 `4104743`이다. 기존 북마크 개선 커밋 3개를 먼저 push했고, 이 브랜치에 보안 수정을 추가한다. PR 생성·병합·운영 배포는 수행하지 않는다.

## 확인한 실패

[Security Gate 실행 40156245455](https://github.com/rlatmfrl24/applemint-v3/actions/runs/40156245455)는 2026-10-25에 기본 브랜치의 `ac5059872891e1779630a9a644661c5692d69719`를 검사했다. `Audit high and critical dependencies` 단계에서 `cheerio → undici 7.30.0`의 고위험 서비스 거부 취약점 때문에 종료 코드 1로 실패했다. 이후 override 검증과 저장소 경고 수집 단계는 실행되지 않았다.

현재 브랜치에서도 `pnpm audit --json`으로 동일한 고위험 1건과 보통 위험 4건을 재현했다. GitHub 저장소 경고는 [Dependabot #147](https://github.com/rlatmfrl24/applemint-v3/security/dependabot/147) 1건이며, 기본 브랜치의 `@vitest/mocker 4.1.11`에 대한 보통 위험 경고였다. 열린 CodeQL·비밀정보 경고는 각각 0건이었다.

## 수정

| 구성요소 | 변경 | 해소한 감사 항목 |
| --- | --- | --- |
| Cheerio의 간접 의존성 `undici` | 7.30.0 → 7.30.1 | 과도한 Content-Encoding 응답으로 발생하는 프로세스 종료(고위험), EventSource 메모리 고갈·SRI 우회(보통 위험 2건) |
| `vitest`, `@vitest/coverage-v8`, 내부 mocker 계열 | 4.1.11 → 4.1.12 | 수동 mock 등록 코드 주입·Windows 역슬래시 경로 우회(보통 위험 2건) |

공식 수정 근거: [Undici 보안 권고](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), [7.30.1 릴리스](https://github.com/nodejs/undici/releases/tag/v7.30.1), [Vitest Windows 경로 보안 권고](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp), [4.1.12 릴리스](https://github.com/vitest-dev/vitest/releases/tag/v4.1.12).

패키지 관리자로 lockfile을 갱신했고, 새 의존성 트리에서 발생한 PostCSS·WASM runtime 중복도 기존 허용 버전 범위 안에서 정리했다. Node 24.x, pnpm 10.33.0, 기존 `undici 8.12.3` 경로를 유지했다. override 추가·보안 기준 완화·baseline 변경은 없다.

정적 호출 경로 확인에서는 Cheerio의 `load()` 기반 HTML 파싱만 발견했고, `fromURL()`이나 패키지 `undici.fetch()`의 직접 사용은 발견하지 못했다. 확인한 코드 기준으로 해당 HTTP 취약점의 직접 악용 가능성은 낮지만, 취약 의존성 자체를 제거했다. Vitest 경고는 Windows 개발 환경의 mock 서버 기능과 관련된다.

## 검증

- `pnpm audit --audit-level low`: 알려진 취약점 0건. 수정 전 1 high·4 moderate에서 모두 해소했다.
- `pnpm install --frozen-lockfile`, `pnpm dedupe --check`, `pnpm security:overrides`, `pnpm check`: PASS. Override 0개.
- `pnpm verify`: PASS. Vitest 1,033개 통과·기존 3개 건너뜀, pgTAP 917개/42파일, 생성 타입·빌드·tRPC 경계·번들 제한 통과.
- 독립 의존성 리뷰: PASS. 변경된 패키지 22개의 integrity가 npm 메타데이터와 일치하고, Node 24 및 peer 버전 범위와 호환됨을 확인했다.
- 로컬 `security:gate`: PASS. 모든 경고 수집원이 정상 응답했고, 기존 정책인 high/critical 0건을 만족했다. 기본 브랜치의 medium 경고 1건은 수집 결과에 그대로 남았다.

로컬 검증 근거는 ignored 경로 `reports/bookmark-review-performance/security-*`에 보관했다. 원격 실행 결과는 이 브랜치를 대상으로 한 GitHub Actions의 CI·Security Gate 실행 기록에서 확인한다. 기본 브랜치의 경고 해소와 예약 검사 결과는 이 변경이 병합된 뒤 별도 확인이 필요하다.

북마크 동작, 월 $1 AI 예산, 자동 삭제 없는 흐름과 운영 데이터는 변경하지 않았다. 자동 smoke·Playwright E2E 및 운영 배포는 수행하지 않았다.
