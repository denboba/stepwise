# P1 — Reliable outcome journey: design

Companion to [requirements.md](requirements.md). Grounded in the code on `main` @ `5ae4d49`; see [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) for the full ownership map.

## Principles carried into every increment

- **Pure core, thin server.** New rules land in pure modules (`engine.ts`, `casefw.ts`, new `src/lib/*.ts`) with unit tests. `goals.functions.ts` only loads, calls the rule, and persists.
- **AI proposes, code decides.** No increment lets model output set `done`, `achieved` or a lifecycle status.
- **No migration without review.** Increments 1–3 change no schema. Increment 4 is blocked on [ADR-0001](../../../docs/decisions/0001-persisted-goal-lifecycle.md).
- **Small PRs, no formatting churn.** Touched legacy files are not reformatted; new files follow `.prettierrc`. The formatting debt is a separate mechanical PR (P0.2a).

## Current write path (relevant parts)

```text
goalAction / submitProof / submitGoalCheck  (goals.functions.ts, auth middleware → userId, RLS client)
  before = loadGoal(rlsClient, goalId)            // RLS: other users' goals → NotFound
  after  = dispatch(before, action)               // pure engine + optional AI calls
           side writes during dispatch (service role, scoped by goal_id/user_id):
             plan_patches, plan_revisions, goal_steps.stuck_count/override_offered/timer_*,
             photo_checks, proof_overrides, goal_check_results
  saveChanges(admin, userId, before, after)       // goals.server.ts
     copyPlan            (first plan only)  ← D4: plain insert
     proof_submissions + goal_steps.done    (newly completed)
     messages insert     (seq = goal.seq + n) ← D5: conflict detected only here
     goals update        (flags, seq)
```

## Increment 1 — Honest routing, recovery and progress (R1, R2, R3)

### Template matcher (R1)

`Plan.keywords` keeps its type (`string[]`) so stored custom plans are unaffected (they hold `[]`). Its meaning becomes **match phrases**:

- A phrase is space-separated tokens. Text is lower-cased, `’` → `'`, and split on `[^a-z0-9']+`.
- A token matches a whole word; a trailing `*` matches a word prefix (`charg*` → charge, charger, charging).
- A template matches when all tokens of any one phrase appear (any order).
- Precision over recall: a miss falls through to the general AI intake, which is the safe failure mode; a false hit hijacks the goal.

New phrases:

| Template | Phrases |
| --- | --- |
| phone | `phone charg*`, `iphone charg*`, `android charg*` |
| website | `website`, `web site`, `webpage`, `web page`, `landing page` |
| robot | `line follow*` (the text "line-following" splits into `line` + `following`) |

`planForText(text, plans)` keeps its signature, so `store.ts` (client prediction) and the server use the same function.

### Intake state (R2)

Extract the pure part of `customIntake` into `engine.ts`:

```ts
export function intakeTurn(g: Goal, text: string): { goalText: string; intake: IntakeAnswer[] }
```

- `goalText` = first user message on the goal (or `text` if none yet).
- If an intake question is pending → append `{ q, a: text }`.
- Else if this isn't the first message → append `{ q: EXTRA_DETAIL_Q, a: text }`.
- `MAX_INTAKE_QUESTIONS` continues to count all entries, so extra detail moves the user toward a plan rather than more questions.
- `planFailed` text changes to "I couldn't build a safe plan yet. Tell me more about the goal, your tools or constraints, and I'll try again." (≤ 25 words, tested).

### Progress and list status (R3)

```ts
export type GoalListStatus = "intake" | "ready" | "active" | "paused" | "check" | "achieved";
export function goalSummary(f: { planned; started; paused; achieved; done; total }): { percent; status }
```

`progress(goal)` uses the same percent rule. `listGoals` selects `started, paused` in addition and returns `{ id, title, percent, status }`. The sidebar shows `status` as a short text chip; the percent remains for in-progress goals. The ring in the header keeps "done of total steps" (it already labels steps, not outcome).

**Compatibility:** read-only change; no stored data changes.

## Increment 2 — Write integrity (R5)

### Compare-and-set claim

At the top of `saveChanges`:

```ts
const claim = await admin.from("goals")
  .update({ seq: after.seq, updated_at: now })
  .eq("id", after.id).eq("seq", before.seq)
  .select("id");
if (!claim.data?.length) throw new StaleGoalError();
```

- Callers (`goalAction`, `submitProof`, `submitGoalCheck`) catch `StaleGoalError` and return `{ ok: true, goal: fresh, notice }`, so the UI refreshes instead of showing a generic failure. The store shows `notice` as a toast.
- Actions with no new messages (`pause`, `startTimer`) claim `seq = before.seq` — still a valid compare-and-set against any concurrent writer that did push messages.
- If a later write fails after a successful claim, the seq gap is harmless: message ids derive from stored `seq`, and `loadGoal` orders by `seq`.

**Known limit:** side writes made during `dispatch` (listed above) happen before the claim. They are either idempotent claims of their own (`plan_patches.status`, `timer_done_posted`), audit inserts that tolerate a duplicate (`photo_checks`, `goal_check_results`), or counters (`stuck_count`). A true transaction needs a Postgres function (ADR-0001, option B) and is deferred.

### Idempotent first plan

`copyPlan` first deletes `proof_items`, `step_prereqs`, `goal_steps`, `custom_plans` rows for the goal, then inserts. It is only called when `before.planned === false`, which the server read through RLS. A goal that isn't planned has no legitimate step rows, so the delete only removes debris from an interrupted attempt. Proof submissions are never deleted (an unplanned goal can't have any).

### Testing approach

A small in-memory fake implementing the subset of the Supabase query builder used by `goals.server.ts` (`from().select/insert/update/delete/upsert().eq().in().is().order().limit().maybeSingle().single()`), recording each operation. Tests assert operation order and that nothing is written after a lost claim. This is a unit-level stand-in; RLS and real constraint behavior stay in R8.

## Increment 3 — Life-safety gate (R6)

New pure module `src/lib/safety.ts`:

```ts
export function stopWork(text: string): Escalation | null   // wraps casefw.detectRedFlag(text) (code rules only)
```

`goalAction` checks `a.type === "text"` before `dispatch`. On a hit it pushes the user text and one assistant line: `"Safety first: <sign>. <action>"`, then saves. No AI call, no plan, no state flags change. `submitProof` free-text values are not gated in v1 (they are proof data, not instructions) — documented.

Why not the tier-3 domain rules (`riskMatches`) yet: they intentionally match ordinary planning ("replace a wall socket"), which should route to *professional preparation*, not *stop now*. That needs the persisted `escalated` state and a professional-prep plan shape (R4 + P4.3).

## Increment 4 — Persisted lifecycle (R4)

Blocked on ADR-0001 approval. Summary of the proposal: additive `goals.status`, `status_reason`, `status_changed_at` with a check constraint; deterministic backfill from booleans; pure transition table `src/lib/lifecycle.ts`; new actions `endGoal(reason)` and `markEscalated(reason)`; booleans kept in sync. Generated `src/integrations/supabase/types.ts` must be regenerated by the Lovable/Supabase tooling, not by hand.

## Increments 5–7

- **5 Proportional evidence (R7):** change `validateAiPlan` / `validateAiStep` thresholds behind a risk input; requires a short design note on what "low risk" means in code (safety note absent, no timer, tier 1).
- **6 Real-database tests (R8):** needs a maintainer to provide a disposable Supabase project or approve running `supabase start` in CI (Docker). Vitest `integration` project, skipped when env is absent.
- **7 Scripted journeys (R9):** inject an `AiPort` interface into `dispatch` so tests replace `ai.server.ts` calls with fixtures. Requires a small refactor of `goals.functions.ts`; do after Increment 2 to avoid conflicts.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| AI gateway error / invalid JSON | Existing `aiError` line with Retry; retry removes the error and echoed text (unchanged). |
| Plan fails validation twice | `planFailed` line inviting more detail; next text is persisted as extra detail (R2). |
| Rate limit | Existing rate line. |
| Lost compare-and-set | Fresh goal + notice toast; nothing written (R5). |
| Interrupted first-plan write | Next attempt clears debris and succeeds (R5). |
| Life-safety text | Stop-work line, no AI call (R6). |

## Rollback

Increments 1–3 are code-only: revert the PR. Increment 4 has its own migration rollback in ADR-0001.
