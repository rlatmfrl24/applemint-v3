# 북마크 UI·UX 구현 검증

구현 브랜치 `codex/bookmark-ux-redesign`, 기준 `576e1f9`, 1차 제품 코드 `7af63fac526d6b9d58146a253b813958e9c2db82`. 아래 전체 검증은 이 1차 구현의 기록이며, 이후 키보드 초점 수정은 마지막 추가 검증 절에 기록했다. 격리 worktree에서 구현했고 원본 checkout은 깨끗하다. push·PR·병합·배포는 실행하지 않았다.

## 실제 도달 가능한 결과

- 데스크톱 240px 컬렉션 / 목록 / 360px 상세, 태블릿·모바일 Drawer. 1440×900 기본 목록 8행 이상, 모바일 가로 넘침 없음.
- 초기 스켈레톤, 기존 데이터가 유지되는 갱신·추가 로딩/실패 재시도, 한글 조합을 고려한 250ms 검색.
- Main·Quick 저장 진입점의 자동 추천, 사이트 일치 우선, 추천 중 컬렉션·저장 잠금, 입력·취소 허용. 같은 요청 ID/등록 Promise 재사용, 조회만 재시도, 제목 변경/늦은 응답 보호, 30초 뒤 수동 선택.
- 컬렉션 전체 경로 검색·트리·이동, 제목 2줄과 별도 URL/경로, 상세의 전체 URL·복사. 이동·휴지통·복원의 작업별 낙관적 표시와 단건 실행 취소. 원본 infinite-query 페이지와 offset을 유지한다.
- 최신 상세 조회와 수정 기준 버전 유지. 컬렉션만 수정해도 닫기/항목 전환을 확인하고, 반응형 경계를 넘어도 편집값이 유지된다. 내부 보기·헤더 링크는 미저장 확인을 거친다.
- 관심 주제 즉시 표시·실패 복구·중복 후보 제거, 실제 장부 요약, 필요할 때 펼치는 지연 로딩 통계, 초기 작업 기록 로딩, 제한된 모션과 reduced-motion.
- 신규 의존성·DB 마이그레이션 없음. 소유자/RLS, 안전한 URL, 원본 보존, 버전 충돌, 유지 검토와 AI 승인, KST 월 예산/불명확한 예약 정책을 유지했다.

## 검증 결과

| 검증 | 실제 결과 |
|---|---|
| `pnpm typecheck` | PASS (`reports/ux-reviewed-final-types.log`) |
| `pnpm verify` | PASS: Biome/Knip/DB 타입, Vitest 645 PASS·2 opt-in skip, pgTAP 778 PASS, production build와 server boundary 125파일 |
| 초기 번들 | `/main` 127.3 KiB gzip, 기존 129.0 KiB 한도 이내. 저장 폼·상세 모델 통계 지연 로딩 유지 |
| 북마크 전용 Playwright 전체 | 61 PASS·8 explicit opt-in skip, 6.4분 (`reports/ux-e2e-reviewed-final.log`) |
| 추천 조회 실패 추가 회귀 | 실제 완료 작업의 첫 결과 조회를 실패시킨 뒤 조회만 재시도: PASS, 유료 등록 0, 장부 불변 (`reports/ux-query-retry-final.log`) |
| 독립 리뷰의 입력 소실 3건 | 각각 RED→GREEN, 전체 suite GREEN. `reports/ux-review-red.log`, `ux-breakpoint-red.log`, `ux-review-green.log` |
| 실제 화면 | 1440×900 / 1024×768 / 390×844, dark/light, 키보드, 200% 상당 CSS reflow 및 reduced-motion PASS |

일반 `pnpm test:e2e`와 실자료 초기화 명령은 실행하지 않았다. 기존 서버와 `playwright.bookmarks.config.ts`를 사용했다. 8개 선택 실행은 유료 AI 분류/검토, 별도 실패 작업 재개·이전 QA 정리, 실제 링크 검사, 과거 이관 자료 상태에 의존하는 시나리오다. 이 전체 실행에서 다시 켜지 않았다. 이번 작업의 Main·Quick 실제 추천·저장은 아래처럼 별도 실행했다.

초기 전체 실행 한 번은 컬렉션 생성 후 팝업이 닫히지 않아 55 PASS·1 FAIL·8 skip이었다. 당시 UI에 오류는 없었고 해당 이름의 잔여 컬렉션도 없었다. 원인은 확정하지 않았다. 동일 테스트의 별도 trace-enabled 실행과 최종 전체 실행은 모두 통과했다. 재발하면 `reports/ux-e2e-handoff.log`와 서버 로그를 기준으로 조사한다.

## 실제 Main·Quick 저장과 권위 있는 readback

아래 두 경로는 실제 Main/Quick 카드 → 자동 Jev 추천 → 사용자가 컬렉션 확인/선택 → 저장 → 관리자 → 새로고침 → 소유자 DB·정산 영수증 조회로 검증했다. 실패 주입이나 저장 API 직접 호출로 대체하지 않았다. 기존 저장 대상이 모두 기등록되어, 실제 공개 Next.js 문서에 UUID QA 표식을 붙인 소수의 로컬 원본을 준비했다. 원본 준비만 수집기 바깥에서 수행했다.

| 경로 | 작업 / 저장 ID | 실제 정산 |
|---|---|---|
| Main | `560d8b71-c515-4847-a279-b022e571b38a` / `4430934b-88e1-487f-85f4-27f134dff4f7` | 113148 nano, settled |
| Quick | `668cdb6a-9afd-431e-8790-25c243d3ebff` / `7f0c4676-ed0c-4fd3-b37f-d3a439e8e846` | 113106 nano, settled |

합계 **$0.000226254**, `reports/ux-live-save.log`. Quick은 추천과 다른 최종 컬렉션을 직접 선택해 저장값을 확인했다. 다른 기존 CRUD 회귀에서도 자동 추천이 실행되었으므로 이 두 건의 합계를 작업 전체 비용으로 표현하지 않는다.

최종 `bookmark_ai_usage` 소유자 readback: 2026-10 월 정산 **11630485 nano ($0.011630485) / $1**, 요청 62건, 예약액 **0**. 이는 작업 전 사용량을 포함한 월 누계다. `reports/ux-final-authoritative-readback.json`에 기록했다.

검증 후 이번 UUID 표식의 원본 7개·북마크 7개만 기존 UI로 휴지통에 옮겼다. 모두 `trash`임을 소유자 DB로 확인했고 영구 삭제하지 않았다. 중단된 테스트가 남긴 확인된 빈 컬렉션 1개는 기존 삭제 UI로 archive했다. QA 표식 밖의 원본은 정리 대상에 포함하지 않았다. 단순 원본 총수는 최초 Main의 가시 카드 수와 다르므로 데이터 보존의 증명으로 사용하지 않는다.

## 디자인 QA와 남은 한계

[`design-qa.md`](../../design-qa.md)는 같은 크기·상태의 기준과 구현을 한 비교 화면에 넣고, 전체/부분 비교 후 P2 3건을 수정·재캡처한 기록이다. 최종 전달 캡처는 `reports/bookmark-workspace-delivery.png`, 편집 보호는 `reports/edit-protection-final.png`다. 스크린샷과 실행 로그는 로컬 ignored `reports/`에 보존하며 Git에는 포함하지 않는다.

독립 리뷰는 `gpt-6-astra` fresh context에서 `576e1f9..71d3ca6` 전체를 확인했다. Critical 없음, Important 3건(컬렉션만 편집한 dirty 누락, 반응형 재마운트 초안 소실, 보기 전환 시 초안 소실)은 테스트에서 실패를 먼저 확인하고 `7af63fa`에서 수정했다. Declined to judge 없음. 재리뷰를 반복하지 않고 전체 suite로 회귀를 확인했다.

초기 Deferred minor였던 데스크톱 상세 진입의 키보드 초점 문제는 후속 요청으로 수정했다. 마지막 추가 검증 절을 참조한다.

실제 운영 배포, 브라우저 메뉴 자체의 200% 확대, 실기기 소프트 키보드, 스크린리더는 확인하지 않았다. CSS 720×450/DPR 2 reflow는 네이티브 확대를 완전히 대체하지 않는다. 자동 추천의 호출량 증가 위험은 요청 재사용·중복 방지와 기존 예산 정책으로 제한하지만 운영 트래픽 측정은 필요하다.

## 실행 원장

아래는 작업 완료 후 전용 scratch workspace를 제거하기 전에 보존한 실행·판단 기록이다.
# SDD ledger — plan: docs/superpowers/plans/2026-10-15-bookmark-ux-redesign.md

Spec: plan Product Contract; user explicitly requested implementation 2026-10-15.
Baseline: 576e1f9; isolated native worktree, codex/bookmark-ux-redesign.
Pre-flight: Task 2→3 shared picker/Drawer: keep source-save lazy loaded; Task 2→4 ID detail and immutable query pages: mutations use separate projection; Task 3→5 configuration/usage: no optimistic money; Task 4→5 interests version: serialize whole editor.
Ruling: the user-approved chat plan is the self-contained spec; executable task headings added without changing its behavior. Cost if wrong: documentation correction only.
Ruling: the native worktree starts detached; created codex/bookmark-ux-redesign before editing. Cost if wrong: branch rename only.

Task 1: in progress.
Task 1: complete (commits 576e1f9..ee8c0a1, tests: pnpm exec vitest run bookmark →    Duration  3.49s (transform 1.64s, setup 0ms, import 6.13s, tests 1.75s, environment 3ms))
Task 2: real UI RED (missing anchor/skeleton) → GREEN. Existing manager/navigation + new UX: 23 passed, 2 opt-in skipped; 1440x900 8 rows, mobile no overflow, owner DB collection/selection readback PASS. Initial old edit-dialog assertion failed after intentional panel change; updated that selector.
Task 2: complete (commits ee8c0a1..7b24179, tests: pnpm exec playwright test --config playwright.bookmarks.config.ts e2e/bookmark-ux.spec.ts →   5 passed (10.4s))
Task 3: identity unit 2 RED→GREEN; automatic lock UI RED→GREEN. Recommendation regression 8 pass; actual Main and Quick Jev→save→owner DB + settled receipts 2 pass ($0.000226254 combined), monthly ledger 9028879 nano/$1. Ruling: all original 22 sources were already bookmarked, so two local QA sources use real Next.js public documentation URLs; only setup bypasses ingestion, all recommendation/save/auth/readback use the intended UI and existing owner APIs. Cost if wrong: two clearly marked QA sources/bookmarks, preserved for reversible cleanup.
Task 3: complete (commits 7b24179..2527b6b, tests: pnpm exec vitest run lib/bookmark-save-request.test.ts →    Duration  471ms (transform 32ms, setup 0ms, import 159ms, tests 10ms, environment 0ms))
Task 4: optimistic unit 5 RED→GREEN; real owner UI/DB move/trash/restore/concurrent failure, collection order/tree and 200-item pagination 26/26 PASS; typecheck and scoped Biome PASS. Root causes fixed: late selection reset erased the next selection; pending collection reads hid newly created roots; nested Escape closed its parent dialog. Page arrays/offset stay immutable.
Task 4: complete (commits 2527b6b..80b8352, tests: pnpm exec vitest run lib/bookmark-optimistic.test.ts →    Duration  425ms (transform 42ms, setup 0ms, import 161ms, tests 10ms, environment 0ms))
Task 5: interest optimistic failure and duplicate-candidate/collapsed-stat tests RED→GREEN; settings UI add/edit/remove/reload + owner DB and usage ledger 5/5 PASS. Query display-only observer uses skipToken to avoid console errors. Client navigation stalled even with a trivial target: Next 16.3.8 dev Flight decoding waits for its filtered x-nextjs-request-id debug channel; exact framework transport/trace headers restore navigation, forged owner/subrequest headers still blocked (unit regression).
Task 5: Ruling: include the existing middleware header allowlist in scope — the approved Next client navigation cannot work without Flight and dev tracing headers; auth validation and forged privilege-header rejection remain intact — cost if wrong: transport-header correction and navigation regression.
Task 5: complete (commits 80b8352..5de8fa2, tests: pnpm exec playwright test --config playwright.bookmarks.config.ts e2e/bookmark-settings.spec.ts →   5 passed (12.2s))
Task 6: full bookmark regression 54 PASS / 8 explicit opt-in skips before final settings density change; 200→move→trash→300 DB order/unique IDs PASS, code-load skeleton/cancel/focus and 30s manual PASS. Unit stale-conflict refresh RED→GREEN. UI settings priority RED (heading y=664)→GREEN after compacting budget summary. QA comparisons capture exact 1x source pixels with in-app implementation; selected-row and mobile-width P2 fixes passed recapture. Original checkout remains clean.
Task 6: Ruling: native browser modal is used only while the lazy Radix form code loads — importing the complete Radix shell eagerly exceeds the existing Main bundle budget; native modal supplies focus trapping/Escape/inert background without a new dependency — cost if wrong: the brief loading-state styling/focus needs adjustment.
Task 6: Ruling: verify 200 percent reflow with CSS 720x450 and DPR 2 plus reduced motion — browser-menu zoom/native mobile keyboard are not exposed by the available automation surface — cost if wrong: a real-device/browser zoom difference remains unverified and is reported.
Task 6: final lazy loader uses React Suspense; cold-load fault originally matched the eager async-loader registration stub, so it now gates only code requested after the hydrated trigger is clicked. Native cancel focus RED→GREEN. Compact settings priority RED→GREEN; main build 127.3 KiB gzip PASS, full pnpm verify PASS (645 unit + 2 opt-in skipped, 778 pgTAP). Latest full E2E still running; branch review can inspect the completed implementation independently.
Final review: fresh gpt-6-astra reviewed 576e1f9..71d3ca6 and reproduced without POST/DB writes. Critical 0; Important 3 accepted (picker-only dirty, responsive remount draft loss, view-link navigation draft loss); Minor 1 accepted. Declined to judge: none.
Final: fixed collection-only dirty protection — `컬렉션만 편집해도 닫기와 다른 항목 선택 전에 확인한다` RED→GREEN; whole suite pending.
Final: fixed responsive edit draft/version retention — `편집 초안은 데스크톱과 Drawer 경계를 양방향으로 넘어도 유지된다` RED→GREEN (first test selector used getByLabel on a populated nested textarea; corrected to accessible textbox, then observed actual missing input at 1024px); whole suite pending.
Final: fixed internal navigation dirty protection — `보기 전환은 초안 버리기를 확인하고 계속 편집하면 입력을 유지한다` RED→GREEN; same guard covers common header links and beforeunload; whole suite pending.
Final: minor (deferred): desktop detail opens with focus remaining on its row trigger; close restores it, but keyboard users must tab through subsequent rows to reach panel controls. Reviewer graded Minor; accepted as a navigation-efficiency refinement, not data loss. No new review dispatched.
Task 6: prior full E2E 55 PASS / 1 FAIL / 8 opt-in skipped. Failure was collection-create dialog not closing; snapshot showed enabled Save, no visible error, no matching leftover collection. No root cause claimed. Isolated trace-enabled rerun PASS, and current whole run passed the same scenario. Preserve the intermittent observation in final verification evidence.
Final: all 3 Important regressions RED→GREEN; entire bookmark suite 61 PASS / 8 explicit opt-in skips, latest added recommendation-query failure/retry regression 2 PASS including auth setup. Query-only retry and missing-key/budget paths preserve ledger; no new paid registration on result retry.
Task 6: code fixes committed as 7af63fa. Local cleanup through existing UI moved only UUID-marked Next.js QA sources/bookmarks (7 each) to recoverable trash and archived the confirmed empty abandoned QA collection. Owner readback PASS; final monthly ledger 11630485 nano ($0.011630485), 62 settled requests, held 0. This is the monthly total, not all task spend; the explicit Main+Quick proof cost $0.000226254.
Task 6: complete (commits 5de8fa2..7af63fa, tests: pnpm verify → /main/setting/crawling: PASS 120.8 KiB gzip (-30.9%; 12 assets))
Final: task-done full pnpm verify PASS on 7af63fa: 645 unit PASS / 2 opt-in skipped, 778 pgTAP PASS, build/Knip/Biome/types/boundary PASS, Main 127.3 KiB. No required work remains except this documentation/ledger closeout.
Finish: accepted Global Constraints exclude push/merge/deploy. Keep the named branch and managed worktree for review; do not ask again or create external artifacts. Final owner readback has held 0 and only the seven UUID QA sources/bookmarks in trash.


정리 제한: 자동 승인 검토가 폴더 삭제를 포함한 마무리 명령을 `blocked by policy`로 거절했고 상세 사유는 반환하지 않았다. 따라서 이 계획의 ignored `.superpowers/sdd/2026-10-15-bookmark-ux-redesign/` 기록 폴더는 보존했다. 제품·검증 결과에는 영향이 없으며 삭제를 다른 방식으로 재시도하지 않았다. 이는 실행 스킬의 scratch 정리 지침에 대한 추가 판단이며, 비용은 작은 임시 파일이 남는 것이다.

## 추가 검증: 데스크톱 상세의 키보드 초점

2026-10-15 후속 요청으로 남은 초점 문제를 수정했다. 패널 제목에 프로그램 초점을 주고 키보드 초점 표시를 적용했다. 항목/모드에 따라 다시 마운트되거나 데스크톱으로 전환될 때만 초점을 옮기며, 일반 입력·조회 갱신에서는 초점을 빼앗지 않는다. 미저장 내용을 버리고 닫을 때도 기존 목록 버튼으로 돌아온다.

- 신규 실제 UI 회귀에서 진입 제목 초점 실패를 확인했다(`reports/focus-red.log`). 이후 미저장 확인 후 닫기의 복귀 실패도 재현했다(`reports/focus-green.log`). 두 경로 모두 수정 후 GREEN.
- Enter 진입, 제목의 보이는 outline, 다음 Tab의 닫기 버튼, 편집 입력 유지, 다른 항목 전환, 일반/미저장 Escape 닫기, 원래 트리거 복귀를 확인했다.
- 관련 Playwright **9 PASS**(로그인 setup 포함), 미저장 보호·반응형 Drawer·200% 상당 CSS/reduced-motion 회귀 포함: `reports/focus-verified.log`.
- `pnpm typecheck` 및 Biome PASS. 전체 DB·유료 AI·production build는 UI 초점만 바꾸는 이번 후속 수정에서 다시 실행하지 않았다.
- 기존 로컬 Docker를 재사용하고 해당 worktree의 Next dev 서버를 숨김 백그라운드 프로세스로 실행했다. `http://localhost:3000/login` HTTP 200 및 같은 서버의 실제 소유자 UI 회귀를 확인했다. DB 초기화·저장·유료 AI 요청 없음.
- 기존 인앱 탭 직접 연결은 브라우저 URL 보안정책으로 차단되어 재시도하지 않았다. 사용자 탭의 수동 QA 대신 별도 테스트 프로필의 기존 소프트웨어 회귀 결과와 서버 응답을 근거로 삼는다.

## PR 검증과 후속 리뷰 수정

후속 사용자 요청으로 전체 테스트·빌드와 PR 게시가 승인되었다. [PR #188](https://github.com/rlatmfrl24/applemint-v3/pull/188)의 `c95706a`에서 원격 `pnpm verify` 전체가 통과했다(645 단위, 778 pgTAP, production build·번들 한도). 첫 실행의 이미지 레지스트리 요청 제한은 같은 head 재실행에서 해소되었으며 코드 변경으로 우회하지 않았다.

기존 자료를 보존한 별도 localhost 환경에서 일반 E2E 3 PASS와 실제 Main·Quick 자동 추천→저장→새로고침→소유자 DB·정산 장부 확인을 완료했다. 두 명시적 AI 요청 합계는 219492 nano($0.000219492)다. 북마크 전체 실행의 실패 2건은 기존 URL 전제와 낙관적 복원 확정 대기를 수정한 뒤 대상 재검증 및 UX 전체 파일에서 통과했다. 이는 개별 재검증을 합친 근거이며 단일 전체 명령 PASS로 대체하지 않는다. 추가 유료 관심 주제·분류 및 이전 자료 전용 시나리오 5건은 미실시다.

자동 리뷰의 P2는 변경안 폼이 dirty 여부만 알리고 실제 입력은 DOM에 두어 패널↔Drawer 재마운트에서 잃는 문제였다. 제안 ID별 초안을 상위 선택 상태에 보관해 기존 대상·새 이름·승인/충돌 계약을 유지했다. 실제 검토 진입점의 회귀에서 대상 값 소실을 먼저 재현한 후 1440→1024→390→1440 전환, 목록 갱신, 계속 편집, 대상 변경 시 새 이름 초기화를 통과했다(`pr-proposal-draft-red.log`, `pr-proposal-draft-green.log`: setup 포함 2 PASS). 이 회귀의 DB 제안은 UI 초안 테스트용으로 명시해 생성·회수하며 실제 AI 실행 증거로 사용하지 않는다. TypeScript와 대상 Biome도 통과했다.

P1은 같은 문서의 Back/Forward가 클릭·beforeunload 보호를 거치지 않는 문제였다. Window 이벤트는 대상의 리스너 등록 순서를 따르므로 늦게 등록한 capture 처리만으로는 Next의 이동을 막지 못하는 점도 실제 브라우저에서 확인했다. 공유 클라이언트 초기화에서 이력 위치와 보호 리스너를 준비하고, 편집 중에는 기존 항목으로 돌아온 뒤 확인하며 버릴 때 원래 이동을 다시 실행한다. Next의 불투명한 상태와 앞/뒤 항목을 보존하고 임시 history 항목은 추가하지 않는다. 문서 밖 이동은 기존 beforeunload 보호를 유지한다.

Main 헤더→Bookmark의 실제 클라이언트 탐색에서 Back/Forward 각각을 Navigation API 유무 두 경우로 검사해 초안·초점·인접 이력·history 길이와 동일 문서를 확인했다(4 PASS). 컬렉션 필터 후 같은 페이지 헤더 링크로 이력을 쌓은 경우도 1 PASS다. 처음에는 초안 유실을 RED로, 이후에는 계속 편집 후 입력 초점 유실을 RED로 확인하고 모두 수정했다. 공유 청크를 2초 늦춘 보조 검사에서도 보호 리스너가 Next 리스너보다 먼저 등록됨을 확인했다. 이력 추적 단위 테스트는 Next 상태 보존·중복 초기화·push/replace/이전 위치 복귀를 검사한다. Firefox/Safari의 별도 실행은 하지 않았으며 Navigation API 부재는 Chromium에서 재현했다.

두 리뷰 수정을 반영한 제품 코드에서 `pnpm check`와 전체 단위 646 PASS(선택형 네트워크 2건 제외), production build, 서버 경계 125파일이 통과했다. Main 127.6 KiB gzip으로 기존 129 KiB 한도 이내다. 이후 전체 E2E와 해당 head의 원격 필수 CI 결과는 PR 검증 원장에 기록한다.

## 후속 요청: 제목·주소·컬렉션과 행 클릭

사용자 결정으로 제목·행 클릭은 상세, 주소 클릭은 원문 새 탭으로 변경했다. 별도 상세 아이콘을 제거하고 실제 제목 버튼의 조작 영역을 행으로 확장했다. 링크·체크박스·메뉴·검토 버튼은 독립 조작 영역을 유지한다. 이전 경로는 이동·컬렉션 삭제 전 소속 기록으로, 목록에서 제거하고 상세의 ‘이전 컬렉션’과 설명으로 구분했다. DB/API·원본 URL·권한·예산 계약은 바꾸지 않았다.

- 새 데스크톱/모바일 행 회귀에서 기존 제목 링크를 RED로 확인한 후 실제 공개 Next.js 문서의 주소 링크 이동과 상세/선택/메뉴 분리를 통과했다. 최초 네트워크 검증은 가상 테스트 도메인에 도달할 수 없어 실패했으며 실제 저장한 공개 URL로 목적지 검증을 바로잡았다.
- 시각 비교의 P2 강조 누락은 상태 속성만 검사하던 TEST DRIFT였다. hover 없이 키보드 진입해 실제 배경색을 검사하는 RED→GREEN으로 수정했다. `design-qa.md`의 새 기준/구현 비교에서 재캡처를 확인했다.
- 전체 북마크 실행은 67 PASS / 8 선택형 SKIP / 3 FAIL. 세 실패는 이전 일반 E2E가 제거한 FMKorea 검증 글 2건의 전제와 기존 Next.js 검증 글 존재에 대한 전제였다. 격리 DB에 공개 FMKorea 글 한 건만 복구하고, 30초 대기 회귀는 기존 source helper로 자기 검증 글을 만들고 회수하도록 수정했다. 세 대상 재검증은 4 PASS(setup 포함)다. **70개 등록 시나리오의 합성 검증이며 단일 전체 명령 PASS라고 보고하지 않는다.**
- 최종 제품 코드의 행/포커스/드래그/강조/디자인 화면 행렬 7 PASS(setup 포함). 주소의 안전 프로토콜 검사와 native 링크 동작, 실제 열기 기록·이전 경로 DB 보존도 기존 lifecycle 회귀에서 통과했다.
- 최종 `pnpm check`(Biome/Knip/TypeScript), production build, 서버 경계 125파일 PASS. Main 127.8 KiB gzip으로 129 KiB 한도 이내다. 이후 변경은 검증 문서뿐이다.
- 유료 AI opt-in과 실제 링크 재검사는 이 UI 수정에서 재실행하지 않았다. 해당 API/worker 코드는 이전 검증과 동일하며, 이번 실행의 선택형 8건은 별도로 명시한다. 원본 DB 초기화나 일반 E2E 준비 명령은 실행하지 않았다.

## 후속 요청: 항목 라벨 제거와 가시성

반복되는 ‘컬렉션’ 라벨만 제거하고 실제 소속 경로·폴더 아이콘을 유지했다. 제목은 15px semibold/기본 자간, 주소는 13px, 보조 정보는 foreground 70%로 정리했다. 간격을 재배분해 행 높이와 터치 영역을 유지한다. 변경은 공용 행 렌더링과 그 회귀·기준 시안에 한정되며 저장·권한·URL·API/DB·예산 계약은 동일하다.

- 기존 행 회귀의 라벨 존재 검사를 새 요청에 맞춰 변경하고 실제 UI RED(라벨 1개)를 확인했다. 제거 후 데스크톱/모바일의 제목·행·주소·선택·메뉴 분리, 경로 표시, 초점 복귀를 통과했다.
- UX 회귀 7 PASS(setup 포함, `reports/pr-row-polish-regression.log`), 다중 드래그·원상 복구 2 PASS(setup 포함, `pr-row-polish-drag.log`). 1440/1024/390px 양쪽 테마·8행 밀도·200% 상당 CSS 화면·모션 감소를 포함한다.
- 같은 크기·상태의 기준/구현 시각 비교와 12개 텍스트/상태의 최소 대비 7.40:1을 확인했다. `design-qa.md`에 근거와 범위를 기록했다. Impeccable 기계 검사는 빈 결과다.
- Node 24.19.0에서 `pnpm check`(Biome·Knip·TypeScript), production build·서버 경계 125파일 PASS. Main 127.8 KiB gzip으로 기존 129 KiB 한도 이내다. 근거는 `pr-row-polish-{check,build}.log`이며 제품 변경 이후 검증했다.
- 로컬 전체 DB/유료 AI/일반 E2E는 이번 표시 변경에서 반복하지 않았다. 기존 관련 서버 검증과 새 PR head의 필수 CI를 구분해 PR 원장에 기록한다. 기존 개발 서버를 유지하며 원본 DB 초기화·재시작은 하지 않았다.
