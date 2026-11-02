# P1 — Reliable outcome journey: tasks

Each increment is one PR from `main`. A task is checked only when its PR is merged with passing CI. **Status 2026-11-02:** Increments 0–3 merged (#3–#6). In review: typecheck #7, formatting #8, database tests #9, lifecycle #10, journeys #11 (stacked in that order). "Depends on" lists hard ordering; everything else may run in parallel.

## Increment 0 — Spec and baseline

- [x] 0.1 Record verified baseline and defects D1–D9 (requirements.md).
- [x] 0.2 Write requirements, design and tasks for P1.
- [x] 0.3 Draft ADR-0001 (persisted lifecycle + transactional commit) as **proposed**; maintainer review required.

## Increment 1 — Honest routing, recovery and progress · R1, R2, R3

- [x] 1.1 Whole-word phrase matcher in `planForText`; update template phrases in `plan.ts`. *Tests:* positive/negative tables (saxophone, headphones, "in charge of", parasite, robot arm, laptop charge).
- [x] 1.2 Pure `intakeTurn` in `engine.ts`; `customIntake` uses it; persist extra detail in `goals.intake`. *Tests:* first message, pending answer, extra detail after failure, max-questions boundary.
- [x] 1.3 Reword `planFailed` (≤ 25 words, tested).
- [x] 1.4 `goalSummary` + `progress` percent rule; `listGoals` returns `status`; sidebar shows status text. *Tests:* every flag combination; percent < 100 unless achieved.
- [x] 1.5 Update ARCHITECTURE/AGENTS invariants for template matching and progress.

## Increment 2 — Write integrity · R5, R10 · depends on nothing

- [x] 2.1 In-memory fake Supabase client for server-module tests (`src/test/fakeSupabase.ts`).
- [x] 2.2 Compare-and-set claim on `goals.seq` in `saveChanges`; `StaleGoalError`.
- [x] 2.3 Callers return fresh goal + notice on `StaleGoalError`; store shows the notice.
- [x] 2.4 `copyPlan` clears interrupted-attempt rows before insert.
- [x] 2.5 Tests: lost claim writes nothing else; debris cleared then inserted; normal-path order; `loadGoal` round-trip of a saved goal (resume).

## Increment 3 — Life-safety gate · R6 · depends on nothing

- [x] 3.1 `src/lib/safety.ts` `stopWork(text)` wrapping code-only `detectRedFlag`.
- [x] 3.2 Gate all `text` actions in `goalAction` before `dispatch`; no AI call on a hit.
- [x] 3.3 Tests: every life-safety rule positive; ≥ 10 ordinary goals negative; gate makes no state change besides two messages.
- [x] 3.4 Update SAFETY.md "shipped vs target".

## Increment 4 — Persisted lifecycle · R4 · ADR-0001 approved as design · PR #10

> 4.1, 4.4–4.6 implemented in #10 (`end`, `escalate`, `resolveEscalation`; statuses written only when the column exists). 4.2 is `db/proposed/0005_goal_lifecycle.sql`, validated on PGlite; **not applied** to any Lovable database. 4.3 happens when Lovable applies the migration (docs/MIGRATIONS.md).

- [ ] 4.1 Pure transition table `src/lib/lifecycle.ts` with exhaustive tests (can land before the migration).
- [ ] 4.2 Migration `0005_goal_lifecycle.sql` (additive columns, check constraint, backfill). Apply in a non-production project first.
- [ ] 4.3 Regenerate `src/integrations/supabase/types.ts` with the tooling (not by hand).
- [ ] 4.4 Server actions `endGoal`, `markEscalated`; write status + booleans together.
- [ ] 4.5 UI: "End goal" with reason; honest unresolved/escalated summary card; sidebar uses persisted status.
- [ ] 4.6 Life-safety gate (3.x) sets `escalated` when the goal is unplanned.

## Increment 5 — Proportional evidence · R7 · depends on 4.1

- [ ] 5.1 Design note: risk inputs available in code today.
- [ ] 5.2 Relax proof count for low-risk AI steps; keep objective proof where required; tests including replans.

## Increment 6 — Real-database tests · R8 · local Supabase in CI approved · PR #9

> PGlite (PostgreSQL 18) runs in every test run; a blocking CI job runs against a disposable local Supabase stack. No staging project yet.

- [ ] 6.1 Maintainer provides disposable Supabase project or approves local Supabase in CI.
- [ ] 6.2 Integration suite: cross-user read/write/delete/photo denial; direct-table writes refused; achieved only via `submitGoalCheck`.

## Increment 7 — Scripted reference journeys · R9 · PR #11

- [ ] 7.1 `AiPort` interface injected into dispatch; default implementation is `ai.server.ts`.
- [ ] 7.2 Journeys: laptop shutdown troubleshooting, electronics build, learning a skill — each with failed attempt, reload, correction, failed then passed check.

## Typecheck gate · D10 · PR #7

- [ ] T.1 Fix the 88 existing `tsc --noEmit` errors (mostly `noPropertyAccessFromIndexSignature` in `casefw.ts` and server-function return inference in `store.ts`). No behavior change.
- [ ] T.2 Add a blocking `typecheck` job to CI once the count is zero (CI file change via PR only).

## Separate mechanical PR · PR #8

- [ ] P0.2a Run Prettier over `src/` excluding generated integration files, after Increments 1–3 merge to avoid conflicts.
