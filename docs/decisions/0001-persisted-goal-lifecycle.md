# 0001 — Persisted goal lifecycle and transactional commits

- **Status:** accepted as design direction (2026-11-02). Option A implemented as `db/proposed/0005_goal_lifecycle.sql`, validated in CI; **not applied** to any Lovable database. Procedure: [MIGRATIONS.md](../MIGRATIONS.md).

> **Implementation notes (supersede the sketch below where they differ).** Statuses: `draft`, `understanding`, `active`, `waiting`, `blocked`, `paused`, `verifying`, `unresolved`, `achieved`, `escalated`, `abandoned` (`src/lib/lifecycle.ts`). All except `escalated` and `abandoned` are **derived** on every load and save from stored state, so the column can't drift from the real state; those two are **sticky** and change only through explicit events (`end` with a reason, `escalate`, `resolveEscalation`). `verifying` = checklist complete, Goal check open; `unresolved` = Goal check failed. Neither is ever reported as achieved. Every move is checked against a transition table and impossible moves save nothing. The code writes `status` only when the column exists, so it can merge before the migration. The backfill only touches rows still at the default, so re-running it never overwrites app-written statuses.
- **Spec:** [P1 requirements R4, R5](../../.kiro/specs/p1-reliable-goal-journey/requirements.md)

## Problem and constraints

`goals` stores progress as four booleans: `planned`, `started`, `paused`, `achieved`. The product contract ([PRODUCT_SPEC.md](../PRODUCT_SPEC.md)) needs honest end states (escalated, abandoned) and an unresolved outcome after failed checks. Today a goal that can't be finished stays "in progress" forever.

Writes for one action span several tables in separate HTTP calls (`saveChanges` in `goals.server.ts`). P1 Increment 2 adds a compare-and-set on `goals.seq`, which prevents concurrent duplicate writes but not partial writes after a mid-request failure.

Constraints: Lovable Cloud owns the database and regenerates `src/integrations/supabase/types.ts`; Lovable-connected history must not be rewritten; existing goals and verified work must be preserved; older deployed clients may keep reading booleans for a while.

## Decision (proposed)

### A. Additive lifecycle columns (recommended now)

```sql
ALTER TABLE public.goals
  ADD COLUMN status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','understanding','active','paused','verifying','achieved','escalated','abandoned')),
  ADD COLUMN status_reason text,
  ADD COLUMN status_changed_at timestamptz;

UPDATE public.goals SET status = CASE
  WHEN achieved THEN 'achieved'
  WHEN paused THEN 'paused'
  WHEN started THEN 'active'
  WHEN planned THEN 'active'
  WHEN seq > 0 THEN 'understanding'
  ELSE 'draft' END;
```

- `verifying` is set by code when every step is done and the Goal check is open; `blocked`, `waiting`, `planning` and `diagnosing` from the PRODUCT_SPEC table are left out until there is behavior that needs them (adding a value later is another reviewed migration).
- A pure transition table in `src/lib/lifecycle.ts` decides allowed moves; server functions refuse anything else.
- Booleans stay and are written alongside `status` until every reader has moved; then a later ADR may drop them.
- RLS is unchanged: `authenticated` keeps SELECT-only on `goals` (plus DELETE on own rows). Status is written only by server functions with the service role, scoped to the RLS-loaded goal id.

### B. Transactional commit function (recommended next, separate migration)

A `commit_goal_change(goal_id, user_id, expected_seq, payload jsonb)` Postgres function that performs the claim, plan copy, proof/step updates, message inserts and flag updates in one transaction. Callable by `service_role` only (`REVOKE EXECUTE … FROM public, authenticated`). This removes partial writes entirely but moves logic into SQL, so it should follow A once the write shapes are stable.

## Alternatives considered

1. **Derive everything from booleans and messages.** No migration, but `abandoned` and `escalated` can't be represented, and status reasons have nowhere to live.
2. **Replace booleans with `status` in one step.** Cleaner, but breaks older clients and the Lovable editor's view of the schema at once; harder rollback.
3. **Event-sourced `goal_events` table.** Best audit trail; larger change. Can be added later; `status_reason` + `status_changed_at` cover P1.

## Security, safety and data consequences

- No new client write paths. No new PII; `status_reason` is user text and is treated like chat text (not logged, not sent to analytics).
- `escalated` must never be cleared by model output; only an explicit user action after the safety condition is resolved.
- Backfill is deterministic and only reads existing columns.

## Migration, rollback and test strategy

1. Apply to a disposable/staging project first; compare row counts per status with a query over booleans.
2. Regenerate types with the Supabase/Lovable tooling.
3. Deploy code that writes both status and booleans.
4. **Rollback:** `ALTER TABLE public.goals DROP COLUMN status_changed_at, DROP COLUMN status_reason, DROP COLUMN status;` Booleans remain authoritative throughout, so rollback loses only new reasons.
5. Tests: exhaustive transition-table unit tests; server tests with the fake client; integration test (R8) that `authenticated` can't update `status`.

## Open questions for the maintainer

1. How are files in `drizzle/migrations/` applied to Lovable Cloud today: by Lovable on sync, or manually?
2. Is there a staging/disposable project we can apply migrations to first?
3. Should `abandoned` goals remain visible in the sidebar (greyed) or move to an archive view?
4. Approve A now and B later, or both together?
