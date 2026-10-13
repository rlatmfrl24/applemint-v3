# Applemint Bookmark Manager UI/UX Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline, task by task. Only the final whole-branch review uses a fresh reviewer.

**Goal:** Make collection hierarchy clear and manage bookmarks and review results through compact, separate screens.

**Architecture:** Keep the bookmark DB, owner tRPC and registered-job worker. Add transactional collection archival and server review filters, and split the existing large client screen by UI responsibility.

**Tech Stack:** Next.js 16, React, existing Geist/Radix/Tailwind, tRPC/Zod, Supabase/Postgres, Vitest/pgTAP/Playwright.

**Spec:** This document's Product Contract, approved in the conversation on 2026-10-13. The explicit user decisions override previous library UI/save-entry requirements.

## Product Contract

- Routes: `/main/bookmarks`, `/main/bookmarks/review`, `/main/bookmarks/trash`, `/main/bookmarks/activity`; labels 북마크, 검토, 휴지통, 작업 기록. Activity is a visually secondary tab on the right.
- Remove the manager's save button, direct URL input and settings shortcut. Keep source-thread bookmark saving and access to settings through Setting.
- Library: accordion collection hierarchy, separate expand/select controls, branches initially collapsed, selected ancestors open, session expansion persistence. Selection filters direct membership only.
- Collection create/rename/remove use popups. Create accepts parent (default selected collection); rename edits name only. Delete confirms the named collection and preservation policy.
- Collection deletion moves every member, including trash, to Unsorted and direct children to the deleted collection's parent. Archive with `archived_at`; retain source/original/history. Preserve `previous_collection_path` on moved bookmarks, increment affected versions and exclude affected pending proposals.
- Owner `bookmarkCollection.remove({id,version})` returns `{deletedId,movedBookmarks,reparentedCollections}` atomically. Lifecycle shared locks precede all command/worker row locks; delete takes the same lock exclusively. No lock spans network calls. Archived targets are rejected by all writes and AI commits; known usage still settles.
- `bookmark.list` accepts `reviewType: all|dead|unused|classify`. Server filter/count/page agree; review order is dead, classify, unused, then oldest saved_at and ID. Keep DB state `library`.
- 100 rows/page, selection limited to that page and cleared on route/filter/page changes. Compact 14px title/12px secondary copy; descriptions, notes, originals and proposal editing in popups.
- Review/trash have no collection navigation or CRUD controls, but show current path and prior path when unfiled. Review filters 全部/죽은 링크/미사용 후보/컬렉션 변경안 (visible All label: 전체). Keep processes dead/unused evidence; classify proposals need separate approve/exclude.
- Library retains search/edit/bulk trash/check/AI actions. Check in toolbar, AI in secondary menu. Job scope defaults to selected and is disabled with no selection.
- Activity retains progress/errors/item details/resume. Generic settings jobs become an activity link; import progress, interests and budget remain in settings.
- At 1440x900 at least 8 nonexpanded bookmark rows visible; mobile has no horizontal overflow. Light/dark and keyboard focus remain usable.

## Global Constraints

- Reuse `codex/bookmark-library`, baseline `b540d22`; preserve unrelated original checkout and untracked files.
- Back up the actual local DB and apply only additive migrations. Never reset the shared DB or run E2E prepare that resets it.
- Preserve RLS, owner checks, server-only tRPC boundary, URL safety, import originals, approval/version semantics and $1 KST budget.
- No new UI dependencies, full-library AI calls, push/merge/production migrations/deployment.
- Use actual UI and owner DB readback; tests/mocks support failure checks, never substitute for the user flow.

## Review Focus

1. Delete racing save/approval or an in-flight AI response: no archived membership, deadlock or lost settlement (Task 1).
2. Nested/root collection deletion and trash members: exact reparenting, metadata/source preservation and old path (Tasks 1/4).
3. One item with dead/unused/classify evidence: keep must not accidentally apply/exclude classification (Tasks 1/3/4).
4. Long names, deep hierarchy, 100 rows and narrow viewport: correct selection, density, keyboard focus and no overflow (Tasks 2/5).
5. Removed direct-save entry: source save, duplicate handling, metadata and original source state stay usable (Tasks 4/5).

### Task 1: Collection lifecycle and review query

**Interfaces:** Produces archived collection guards, previous_collection_path, remove result and reviewType for subsequent UI tasks.

- [ ] Back up local DB; write pgTAP tests for deletion/preservation/stale versions/owner checks/filter counts and cross-session race; write Zod/service tests; observe RED.
- [ ] Add migration, owner RPC/service/tRPC/schema and generated DB types. Original import context retains archived source records; user/AI collections exclude them. Apply locally without reset.
- [ ] Run `pnpm exec vitest run bookmark` and `pnpm test:db`. Expected: all selected tests pass.
- [ ] Commit scoped files and record the successful task command in the ledger.

### Task 2: Compact manager, tree and popups

**Interfaces:** Consumes Task 1 remove and active collection list; produces common view shell, collection tree/dialog and compact row/detail dialog.

- [ ] Add tree tests and real-server E2E assertions for missing hierarchy/popup controls; observe RED.
- [ ] Split the large library screen by responsibility; implement session expansion, separate select/expand, popup CRUD, compact rows/details and selected-default job actions. Remove manager save/settings controls.
- [ ] Verify create/rename/delete through UI and DB readback, plus tree/row tests. Expected: working hierarchy/popups and compact persisted manager.
- [ ] Commit and record evidence.

### Task 3: Review, trash and activity screens

**Interfaces:** Consumes Task 1 server reviewType and Task 2 shell/rows/dialogs; produces standalone routes and result approval UI.

- [ ] Add failing route/filter/approval/bulk behavior checks; observe RED.
- [ ] Implement routes, query/back navigation and legacy `?state=trash` redirect preserving search. Show evidence and popup proposal edit/approve/exclude in review, restore in trash and jobs in activity.
- [ ] Move generic settings jobs to an activity link; retain import/interest/budget UI. Run bookmark tests and route/UI readback. Expected: no tree in review/trash, no logs in manager, old proposals rejected.
- [ ] Commit and record evidence.

### Task 4: Real flow verification and QA collection cleanup

**Interfaces:** Consumes the actual user routes and APIs from Tasks 1-3. Tests use source-save rather than resurrecting removed URL input.

- [ ] Adapt E2E; add `playwright.bookmarks.config.ts` for existing localhost server/auth and no DB reset.
- [ ] Verify source save, duplicate/state preservation, collection CRUD/reparent/path, review keep/trash/approve and restore with authoritative readback.
- [ ] Run a small real OpenAI classification and popup edit/approval in review; confirm persistence and settlement.
- [ ] Delete only verified QA collections `AI 검증 정리 1791868938290`, `AI 검증 정리 1791869523870` through the new popup; clean temporary QA collections similarly. Preserve members and source data.
- [ ] Commit tests/evidence and ledger the actual commands/results.

### Task 5: Final verification and independent review

**Interfaces:** Consumes all tasks and checks the accepted product contract on the complete branch.

- [ ] Check 1440x900 density, mobile, light/dark, keyboard/focus return, long/deep/empty cases with actual browser screenshots.
- [ ] Run `pnpm typecheck` and `pnpm verify`. Expected: all checks pass.
- [ ] Package complete diff and ledger; dispatch one fresh-context whole-branch reviewer using requesting-code-review. Fix Important/Critical findings with regression tests and rerun affected checks; record minor deferrals.
- [ ] Update operating documentation and commit only scoped files. Leave local flow reachable; report outcome/readback/evidence and precise unverified limits.
