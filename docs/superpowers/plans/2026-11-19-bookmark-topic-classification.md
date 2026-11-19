# 북마크 주제 우선 분류 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Main·Quick 저장 추천과 관리자 분류에서 주제에 맞는 기존 컬렉션을 먼저 선택하고, 맞는 곳이 없는 커뮤니티 글은 `etc`로 제안한다.

**Architecture:** 공통 서버 정책이 주제 후보와 결과를 검증하고 `etc`를 해석한다. 기존 Jev 추천과 GPT 분류가 같은 정책을 호출하고 기존 소유자 저장·승인 흐름으로 게시한다.

**Tech Stack:** TypeScript, Next.js, React, tRPC, Supabase, OpenRouter, Vitest, Playwright.

**Spec:** [북마크 주제 우선 분류 설계](../specs/2026-11-19-bookmark-topic-classification-design.md)

2026-11-19 후속 결정으로 주제 미일치 링크의 목적지를 `Community / etc`와 최상위 `etc`로 구분했다. 경로별 유일성을 적용한 동작은 위 설계 문서와 `bookmark_etc_route_publication` 마이그레이션을 따른다. 아래 작업은 최초 구현 계획이다.

## Global Constraints

- 저장과 이동은 각각 사용자의 명시적 저장과 승인으로 반영한다. 새 두 경로를 같은 변경으로 제공한다.
- 소유자 인증, 원본과 컬렉션 검증, 요청 중복 방지, 작업·청구 처리, KST 월 $1 한도를 사용한다.
- `etc`는 활성 컬렉션 이름을 앞뒤 공백과 대소문자를 무시해 비교하고, 정확히 하나일 때 기존 ID를 사용한다.
- 기존 DB 스키마와 두 공급자 연결을 사용한다. 공급자 오류나 무효 응답은 기존 실패·중단 흐름으로 처리한다.
- 작업 전에 `AGENTS.md`의 Next.js 문서 안내를 따른다. 실제 UI 검증에는 `playwright.bookmarks.config.ts`를 사용하며 일반 E2E 준비·DB 초기화를 실행하지 않는다.

## Review Focus

- `Community / 블루 아카이브` 같은 주제 하위 폴더는 출처용 상위 폴더를 제외한 뒤에도 선택 가능하다. Task 1.
- 유사 도메인은 등록 커뮤니티로 판정하지 않고, 미등록 포럼 글은 모델이 출처 근거를 찾으면 `etc`로 추천할 수 있다. Task 1.
- `etc` 이름이 없거나 중복되면 임의 선택하지 않고, 관리자에서 이미 `etc`인 경우 중복 이동안을 만들지 않는다. Task 1.
- 모델 응답을 기다리는 동안 생긴 `etc` 중복·이름 변경은 결과 게시 시 DB에서 차단하고 이미 발생한 비용을 정산한다. `supabase/tests/bookmark-community-etc-publication.test.sql`.
- 예산 부족, 구조화 응답 실패, 예약액 초과는 자동 이동 제안 없이 기존 오류·정산을 보존한다. Tasks 1–2.
- 저장 도중 제목·선택·대상 버전이 바뀌면 늦은 추천은 기존 선택이나 최신 입력을 덮어쓰지 않는다. Task 2.

### Task 1 — 공통 주제 정책과 관리자 분류

**Files**

- Create `server/bookmarks/classification-policy.ts`, `server/bookmarks/classification-policy.test.ts`.
- Modify `server/bookmarks/ai.ts`, `server/bookmarks/worker.ts`.
- Test `server/bookmarks/ai.test.ts`, `server/bookmarks/ai-receipt.test.ts`, `server/bookmarks/worker.test.ts`.

**Interfaces**

- `TopicCollection = Pick<BookmarkCollection, "id" | "name" | "parent_id" | "version">`.
- `BookmarkSourceKind = "community" | "other" | "unknown"`.
- `topicCollections<T extends TopicCollection>(collections: T[]): T[]` returns the eligible collection rows. Use the full tree when rendering each row's path.
- `resolveBookmarkTopicTarget(url: string, choice: { collectionId: string | null; newCollectionName: string | null; sourceKind: BookmarkSourceKind }, collections: TopicCollection[]): BookmarkTopicResolution`.
- `BookmarkTopicResolution` is `{ kind: "existing" | "community-etc"; collection: TopicCollection }`, `{ kind: "new"; name: string }`, or `{ kind: "unfiled" | "community-etc-unavailable" }`.
- Export `bookmarkTopicInstructions` from the policy module for both model adapters. Keep provider-specific output instructions in the respective adapter.

- [ ] **Step 1 — Add policy regressions.** With active rows `Community`, `Community / arcalive`, `Community / 블루 아카이브`, and ` Etc `, assert the eligible IDs equal `[blueArchive.id]`. The following calls use `resolve = resolveBookmarkTopicTarget` bound to the indicated collection list via an inline test helper.

  ```ts
  expect(resolve(arcaUrl, { ...noMatch, collectionId: blueArchive.id }).kind).toBe("existing");
  expect(resolve(arcaUrl, noMatch)).toMatchObject({ kind: "community-etc", collection: etc });
  expect(resolve(unknownForumUrl, { ...noMatch, sourceKind: "community" }).kind).toBe("community-etc");
  expect(resolve("https://arca.live.example.org/b/thread/1", noMatch).kind).toBe("unfiled");
  expect(resolve(siteUrl, { ...noMatch, newCollectionName: "정원" })).toEqual({ kind: "new", name: "정원" });
  expect(() => resolve(arcaUrl, { ...noMatch, collectionId: arcalive.id })).toThrow();
  ```

  Use `noMatch = { collectionId: null, newCollectionName: null, sourceKind: "unknown" }`. Assert zero or two matching `etc` rows (including a nested duplicate) both return `community-etc-unavailable`.

- [ ] **Step 2 — Add adapter and worker regressions.** In the real `classify` claim-to-commit test path, assert `bookmark_worker_commit` receives `proposal.collectionId === etc.id` for a valid no-match community response, even if it contains a proposed new name. Assert result exists and `proposal` is absent for a missing `etc` and for an existing `collection_id === etc.id`. Assert a valid model choice of `blueArchive.id` remains the target, while an ineligible choice or missing `sourceKind` fails without a proposal and settles the known charge. Keep the existing provider-limit and review regressions.
- [ ] **Step 3 — Run RED.** `pnpm.cmd exec vitest run server/bookmarks/classification-policy.test.ts server/bookmarks/ai.test.ts server/bookmarks/ai-receipt.test.ts server/bookmarks/worker.test.ts` must fail for the missing policy/contract.
- [ ] **Step 4 — Implement the shared policy.** Match registered HTTP(S) hosts using `getNormalSiteKey` and `NORMAL_SITE_CATALOG` from `lib/community.ts`. Match source collection names exactly after trim/lowercase against `Community`, `커뮤니티`, registered host names, registered labels, and existing short aliases including `arcalive`. Exclude `etc` case-insensitively. Reject an ineligible non-null `collectionId` before considering any fallback. Apply the spec's result table after successful output validation.
- [ ] **Step 5 — Wire the GPT adapter and worker.** For `buildAIRequest("classify", data)` generate a classify-specific strict structured schema with required per-item `sourceKind` and use the shared instructions. Select that parser in `callBookmarkAI` using the request's schema name. In `aiBatch` use the same eligible candidates and full paths for initial and reduced-size classify batches. After usage and item checks resolve by the claimed item's URL. Publish `etc` with `newCollectionName: null` and the server rationale `맞는 주제 컬렉션이 없어 커뮤니티 글을 etc에 제안했습니다.` Omit the proposal for an unavailable or already selected `etc`. Keep the existing review and interest request/output contracts.
- [ ] **Step 6 — Run GREEN.** Re-run the Step 3 command with all tests passing. Keep this change in the same delivery as Task 2.

### Task 2 — Main·Quick 저장 팝업

**Files**

- Modify `server/bookmarks/recommendation.ts`, `server/bookmarks/worker.ts`, `components/use-bookmark-save-recommendation.ts`, `components/bookmark-save-form.tsx`.
- Remove `lib/bookmark-host.ts` and `lib/bookmark-host.test.ts` after replacing their callers and their old shortcut assertions.
- Test `server/bookmarks/recommendation.test.ts`, `server/bookmarks/worker.test.ts`, `components/use-bookmark-save-recommendation.test.tsx`, `components/bookmark-save-form.test.tsx`, `e2e/bookmark-recommend.spec.ts`, `e2e/bookmark-ux.spec.ts`.

**Interfaces**

- Consume Task 1's `topicCollections`, `bookmarkTopicInstructions`, and `resolveBookmarkTopicTarget`. Keep `bookmarkRecommendationSchema` and the `bookmarkAI.recommend` input intact.
- `buildRecommendationRequest(bookmark: { url: string }, collections: TopicCollection[], interests: string[])` accepts the existing server scope with the URL narrowed at the worker boundary. Keep the full scope metadata in `state.bookmark`.
- Jev `collection` offers eligible IDs plus `unfiled`. Add a `source` Choice with `community`, `other`, `unknown` to the same request. Keep `basis` and the existing receipt envelope. `callRecommendation` resolves the validated output using `request.state.bookmark.url` and the full collection list. [TypeSafe Choice protocol](https://docs.typesafe.ai/primitives/choice)

- [ ] **Step 1 — Pin the save-path regression.** In the recommendation adapter tests, assert `Object.keys(request.questions.collection.criteria)` contains `unfiled` and the nested subject ID and excludes the two source rows and `etc`. Valid `unfiled` for a known community URL with one `etc` returns `{ collectionId: etc.id, collectionVersion: etc.version }`. With a missing or duplicate `etc`, assert both fields are `null`. A topic choice returns the topic ID. An invalid source or collection choice returns `recommendation: null` and preserves `chargedNano`. Use the existing provider-response `fetch` fixtures for these assertions.
- [ ] **Step 2 — Pin the UI boundary.** With an `arcalive` collection and a matching source URL, assert `bookmarkAI.recommend.mutate` is called once and the existing `arcalive` ID is never auto-selected. Assert the returned topic ID is applied through the normal fresh-collection check. Re-run the existing stale version, title, duplicate request, and manual override checks. Update browser tests that assumed the removed free selection. Simulated error tests stay on the no-paid-call path.
- [ ] **Step 3 — Run RED.** `pnpm.cmd exec vitest run server/bookmarks/recommendation.test.ts server/bookmarks/worker.test.ts components/use-bookmark-save-recommendation.test.tsx components/bookmark-save-form.test.tsx` must fail on the old source-first or final-selection behavior.
- [ ] **Step 4 — Implement Jev resolution.** Count eligible paths for the existing 254-collection limit and keep the worker pause message for excess candidates. Validate `source` using the same probability/option checks as `collection` and `basis`. For a valid response, resolve before returning the DB recommendation, preserving selected ID and version for both topic and `etc`. Keep the confidence Jev returned for its original `collection` decision. Unknown or unavailable destinations emit the existing unfiled shape. Invalid outputs still report known usage.
- [ ] **Step 5 — Use the normal recommendation entry.** Remove the browser host selection and its button eligibility exception. Preserve existing configuration gating, request reuse, user override, and result-time title/version checks. Remove obsolete host-only test assertions and replace them with the new returned-selection checks. Keep collection lookup before applying a result.
- [ ] **Step 6 — Run GREEN and commit the two entry points together.** Re-run the focused Vitest commands for Tasks 1 and 2 with all tests passing. Run `pnpm.cmd check` to catch callers of the removed helper and full type errors. Commit the scoped implementation and its regression tests together as `feat: prioritize bookmark topics over community sources`.

### Task 3 — 실제 분류 결과 확인

**Files**

- Use `playwright.bookmarks.config.ts`, `e2e/bookmark-recommend.spec.ts`, `e2e/bookmark-ai.spec.ts`, and `e2e/support/bookmarks.ts`.

- [ ] **Step 1 — Record the expected results before sending live requests.** Use real source posts and resolve expected destination IDs in the local owner's existing collection tree. Include abbreviated Blue Archive content, a general post on the same host with no topic collection, a different topic on a community host, and a non-community control. Record the collection path and expected ID per sample. Include a real source that could previously match a source folder.
- [ ] **Step 2 — Verify the save flow in the running app.** Use Main and Quick to open the bookmark dialog and observe the real provider recommendation. Assert the visible target and retrievable recommendation both have the preselected expected ID. Save representative results through the dialog. Reload and read `bookmarks.collection_id` and the linked recommendation/settlement from the owner account. Use the existing `BOOKMARK_LIVE_JEV=1` opt-in for live test execution.
- [ ] **Step 3 — Verify the follow-on manager flow.** Use the real AI collection action on the selected saved sample; confirm expected proposal IDs and `etc` rationale, approve, and compare the reloaded UI and owner DB membership and proposal status. Use the existing `BOOKMARK_LIVE_AI=1` opt-in for live test execution. Preserve real existing bookmark membership by testing approvals only on designated verification items.
- [ ] **Step 4 — Run the broad gate.** `pnpm.cmd verify` must pass in its separate verification database. Record the tested commit, each sample's expected and actual result, live failures if any, and the authorized DB readback. Classify any real mismatch as a failure and fix it through the same entry point before claiming completion.
