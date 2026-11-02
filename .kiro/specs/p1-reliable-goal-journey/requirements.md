# P1 — Reliable outcome journey: requirements

**Roadmap:** P1.1–P1.5 in [roadmap.md](../../../roadmap.md). **Status:** in progress. Each requirement lists the increment that delivers it (see [tasks.md](tasks.md)).
**Journey under test:** create goal → investigate → plan → guide → collect evidence → final goal check → *achieved* or *accurately unresolved*.

## Baseline (verified 2026-11-02 on `main` @ `5ae4d49`)

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | OK, 573 packages |
| `bun run lint:code` | 0 errors, 6 warnings (`react-refresh/only-export-components` in `src/components/ui/*`) |
| `bun run test` | 5 files, 86 tests pass |
| `bun run build` | OK (Nitro/Cloudflare output) |
| `bun run format:check` | Fails: 29 of the checked files under `src/` need Prettier (legacy debt, P0.2a) |
| GitHub CI on `main` | Blocking jobs green; advisory format audit fails as designed |
| Authenticated end-to-end | **Not run.** No test Supabase project or service-role credentials are available to the agent. |

### Defects found while auditing (reproduced in code or tests)

| ID | Defect | Evidence |
| --- | --- | --- |
| D1 | Built-in templates match on substrings. "learn the saxophone", "fix my headphones", "I'm in charge of a wedding" and "my laptop won't charge" all start the **phone charging** plan; "a parasite lab" starts the **website** plan; "build a robot arm" starts the **line-following robot** plan. | `planForText` uses `text.includes(keyword)`; probe run on `main`. |
| D2 | After "I couldn't build a safe plan… Try rephrasing your goal", the rephrased text is ignored: once any intake answer exists, plan generation reuses the original first message. | `customIntake` in `goals.functions.ts` derives `goalText` from the first user message and drops non-answer texts. |
| D3 | A goal with every step done but a failed or unsubmitted Goal check reports `percent: 100`; the sidebar shows "100%". | `E.progress` and `listGoals` compute `done / steps`. Probe run on `main`. |
| D4 | The first plan write is not idempotent. If any write after `copyPlan` fails, every retry hits a primary-key conflict on `goal_steps` and the goal can't be planned without manual DB repair. | `saveChanges` → `copyPlan` uses plain inserts; nothing clears partial rows. |
| D5 | Concurrent requests on one goal (double tap, two devices) both pass validation, both write step/proof rows, and the second fails late on the `messages` primary key, leaving a partial write and a generic error. | `saveChanges` has no compare-and-set on `goals.seq`; message insert happens after step writes. |
| D6 | No deterministic safety gate is active. `src/lib/casefw.ts` (risk rules, life-safety red flags) has no importers; safety relies on the system prompt alone. | `grep` finds no imports of `casefw` functions. |
| D7 | No honest terminal state other than *achieved*. After repeated failed Goal checks the only options are Pause or another replan; there is no persisted *abandoned*, *escalated* or *unresolved* outcome. | `goals` has only `planned/started/paused/achieved` booleans. |
| D8 | Every AI-generated step must carry 2–4 proof items with at least one objective item, regardless of risk (checkbox bureaucracy, P1.4). | `validateAiPlan`, `validateAiStep`. |
| D9 | No automated test touches server functions, persistence or RLS; `goals.functions.ts` and `goals.server.ts` have zero tests. | `src/**/*.test.ts` inventory. |
| D10 | `tsc --noEmit` reports 88 errors on `main` (59 `casefw.ts`, 24 `store.ts`, 5 `goals.functions.ts`) and CI doesn't typecheck, so type regressions can't be caught. | `bunx tsc --noEmit -p .` on `main`. |

## Requirements

Format: user story, then EARS acceptance criteria. "System" means the authenticated server functions plus the pure engine; the browser is never authoritative.

### R1 — Goals route to the right plan (D1) · Increment 1

**User story:** As a person describing any goal, I want Stepwise to use a built-in template only when it really fits, so that I'm never pushed into an unrelated canned plan.

1. WHEN a user's goal text matches a built-in template THE SYSTEM SHALL require every word of at least one of the template's match phrases to appear as a whole word (a trailing `*` permits a prefix, e.g. `charg*`).
2. WHEN goal text contains a keyword only as part of a longer word (e.g. "saxophone", "headphones", "parasite") THE SYSTEM SHALL NOT select the template.
3. WHEN goal text does not match any template THE SYSTEM SHALL use the general custom-goal intake (unchanged behavior).
4. THE SYSTEM SHALL keep goals that already have a plan unchanged (matching runs only for unplanned goals).
5. The browser's "may plan" spinner prediction SHALL use the same matcher as the server.

**Measured by:** table-driven unit tests with ≥ 8 negative and ≥ 4 positive phrases per behavior above.

### R2 — Plan generation recovers with the user's new input (D2) · Increment 1

**User story:** As a user whose plan couldn't be built, I want my rephrased or extra detail to be used, so that retrying can actually succeed.

1. THE SYSTEM SHALL treat the first user message of an unplanned custom goal as the goal statement.
2. WHEN an intake question is pending THE SYSTEM SHALL record the next user text as that question's answer.
3. WHEN no intake question is pending and the goal is unplanned THE SYSTEM SHALL record the user text as an additional detail (`{ q: "More detail from you", a: text }`) and include it in the next intake and plan prompts.
4. WHEN plan generation fails twice validation THE SYSTEM SHALL tell the user the plan could not be built and that their next message will be added as detail (no false promise that rephrasing replaces the goal).
5. Additional details SHALL be persisted in the existing `goals.intake` JSON column (no migration).

**Measured by:** unit tests on the pure intake-state helper covering first message, answer, extra detail and failure line.

### R3 — Progress never implies success before verification (D3) · Increment 1

**User story:** As a user, I want progress to reflect the verified outcome, so that "100%" always means the goal check passed.

1. THE SYSTEM SHALL count the final Goal check as one unit of progress: `percent = achieved ? 100 : round(done / (steps + 1) × 100)`.
2. WHILE a goal is not achieved THE SYSTEM SHALL report a percent below 100.
3. THE SYSTEM SHALL return a status for each goal in the goal list derived only from persisted fields: `intake` ("Getting started"), `ready` ("Ready to start"), `active` ("In progress"), `paused` ("Paused"), `check` ("Goal check"), `achieved` ("Achieved"). This is a read-only projection, not the persisted state machine of R4.
4. The goal list SHALL show that status as text (not color alone), with an accessible label.

**Measured by:** unit tests for `goalSummary` over every flag combination; manual sidebar check.

### R4 — Honest end states (D7) · Increment 4 — **requires approved migration (ADR-0001)**

**User story:** As a user, I want to end, escalate or mark a goal unresolved, so that the record says what really happened.

1. THE SYSTEM SHALL persist a lifecycle status from the PRODUCT_SPEC table, initially: `draft`, `understanding`, `active`, `paused`, `verifying`, `achieved`, `escalated`, `abandoned`, with a `status_reason` and `status_changed_at`.
2. THE SYSTEM SHALL validate every status transition in a pure, tested transition table; invalid transitions SHALL be refused server-side.
3. WHEN a user ends a goal THE SYSTEM SHALL require a reason and record it; the goal SHALL NOT be shown as achieved.
4. THE SYSTEM SHALL keep the existing boolean columns written consistently until all readers move to `status` (backward compatibility with the Lovable editor and older clients).
5. Existing goals SHALL be backfilled deterministically from booleans; rollback SHALL be dropping the additive columns.

### R5 — Writes are atomic enough to never strand a goal (D4, D5) · Increment 2

**User story:** As a user on two devices or with a flaky connection, I want duplicate or interrupted requests to leave my goal consistent, so that I never need support to fix it.

1. THE SYSTEM SHALL claim each state change with a compare-and-set on `goals.seq` (`UPDATE … WHERE id = :id AND seq = :before`) before writing steps, proof or messages.
2. WHEN the claim affects zero rows THE SYSTEM SHALL write nothing further and return a recoverable result ("This goal changed in another window. Showing the latest.") with the fresh goal.
3. WHEN the first plan is written THE SYSTEM SHALL remove any rows left by an earlier interrupted attempt for that unplanned goal before inserting, so that a retry succeeds.
4. The claim SHALL NOT change any other column, so an interrupted request leaves at most a harmless gap in message sequence numbers.
5. THE SYSTEM SHALL keep scoping every service-role write by the RLS-loaded goal id and authenticated user id.

**Measured by:** unit tests with an in-memory fake Supabase client: claim lost → zero further writes; stale rows → cleared then inserted; normal path → order claim, plan, proof, steps, messages, goal flags.

### R6 — Life-safety stop-work gate (D6) · Increment 3

**User story:** As someone describing an emergency, I want Stepwise to stop and direct me to urgent help immediately, regardless of what the AI would say.

1. WHEN any user text matches a code-defined life-safety red flag (`detectRedFlag` in `casefw.ts`) THE SYSTEM SHALL reply with that flag's stop-work action before, and instead of, any AI call for that message.
2. THE SYSTEM SHALL NOT generate a plan, intake question, hint or side answer for that message.
3. THE SYSTEM SHALL NOT mark anything done or change plan state as a result.
4. The gate SHALL run on goal text, intake answers, replan answers and side questions, for template and custom goals.
5. The gate SHALL avoid known false positives ("my code is on fire" is out of scope for v1; listed as a documented limitation) and be covered by positive and negative tests.
6. Persisting an `escalated` status is deferred to R4.

### R7 — Proportional evidence (D8) · Increment 5 — design review first

1. THE SYSTEM SHALL allow AI-generated low-risk steps to use one confirmation item.
2. Steps with a safety note, a wait timer or a `risk_tier ≥ 2` frame SHALL keep at least one objective item.
3. Replans SHALL keep the existing "never weaken proof" rule.

### R8 — Authorization and persistence are tested against a real database (D9) · Increment 6 — infrastructure needed

1. A disposable Supabase project (or local `supabase start`) with two test users SHALL run integration tests in CI on demand.
2. Tests SHALL prove: user B cannot read, mutate, delete, upload to or replan user A's goal or photos; direct table writes from `authenticated` are refused; `achieved` can't be set except through `submitGoalCheck`.

### R9 — Reference journeys run end to end with a scripted AI · Increment 7

1. A scripted AI double SHALL drive three journeys through the server dispatch: laptop shutdown troubleshooting, an electronics build, learning a skill.
2. Each journey SHALL include a failed attempt, an interrupted session (reload from persisted rows), a user correction and a final check that first fails then passes.
3. Assertions SHALL include: no repeated intake question, no false completion, no lost context after reload.

### R10 — Interrupted sessions resume faithfully · covered by Increments 2 and 7

1. WHEN a user reloads or signs in elsewhere THE SYSTEM SHALL restore messages, plan, completed steps, submitted proof, timers and pending intake/replan questions from persisted rows.
2. Unsubmitted drafts SHALL never be shown as saved progress.

## Non-goals for P1

Durable structured memory (P2.2), hierarchical graph (P3), new UI layout (P6/UX), web research, removing word limits (P2.1). These are tracked in the roadmap and must not be smuggled into P1 PRs.
