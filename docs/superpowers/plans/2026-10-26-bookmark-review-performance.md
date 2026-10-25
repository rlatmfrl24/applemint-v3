# Bookmark Review Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four approved review findings so the current review list and open details remain usable at 33k bookmarks.
**Architecture:** Keep Browser → tRPC owner procedure → service/repository → Supabase RPC. Add a migration for set-based snapshot classification and owner-only collection reads; publish a durable health-result revision in existing job progress. Coalesce list/detail refreshes without aborting an active fetch.
**Tech Stack:** Next 16.4, React 19, TanStack Query 5, PostgreSQL 17, Node 24, pnpm 10.33.
**Spec:** User approval of findings 1–4 in this chat; existing `docs/superpowers/specs/2026-10-22-bookmark-content-health-design.md:174-180`.

## Global Constraints
- Shared KST monthly AI limit remains 1,000,000,000 nano-dollar ($1).
- No automatic bookmark deletion or trash movement; explicit keep/trash/restore with version/evidence checks.
- Preserve all review filters, counts, page ordering, legacy checked_url rules, raw response shape and owner/RLS boundaries.
- Use additive CLI-generated migrations; do not reset an existing DB or change production during implementation.
- Reuse the attached worktree and existing dependencies. Preserve root untracked approved documents.

## Review Focus
- Many unchecked bookmarks and wide evidence must not trigger per-bookmark classification or per-page evidence scans.
- Current/stale/reviewed checks must retain identical filter and detail semantics.
- Job claim/host waits without published evidence must not cause refreshes.
- Results arriving during a slow multi-page fetch must eventually refresh without cancellation or lost updates.
- An open detail must refresh on the same result event without overwriting an unsaved edit.

## Tasks
1. [x] Add a failing database scale/semantics regression; optimize snapshot via additive migration. Verify all existing filter/budget/owner tests and read-only real-size comparison.
2. [x] Add failing collection repository/router/owner tests; implement dedicated owner RPC and remove unconditional 10-second collection polling. Generate/check DB types.
3. [x] Add failing job-result/slow-fetch tests; publish evidence revision from actual check commits and coalesce refreshes. Verify initial load, next page, failure and unchanged-progress cases.
4. [x] Add failing open-detail update test; refresh list and detail together while preserving edit drafts and evidence conflict checks.
5. [x] Run repository checks/full isolated verification, direct local flow where available, fresh whole-branch review and fix important findings. Record completed evidence and production limits.
