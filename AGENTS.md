<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Stepwise — instructions for all coding agents

**Always read [PRODUCT.md](PRODUCT.md), [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md), [roadmap.md](roadmap.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before proposing a substantial feature.** Follow [docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md) for execution and reporting. Treat [docs/SAFETY.md](docs/SAFETY.md) and [docs/SECURITY.md](docs/SECURITY.md) as mandatory.

**What we are building:** an outcome-oriented AI expert partner. It models the whole mission, asks for relevant facts, guides one useful interaction at a time, teaches when needed, remembers context and attempts, diagnoses failure, maintains an adaptive dependency graph and only declares achievement on sufficient evidence. **This vision is ahead of the current implementation**—do not claim unimplemented behavior is shipped.

**Source of truth order:** actual code and tests for current behavior; PRODUCT_SPEC for intended behavior; PRODUCT for principles; roadmap for sequencing. If they conflict, document the inconsistency rather than guessing.

**Every work item:** (1) link a roadmap outcome, (2) scope the minimal change, (3) preserve deterministic server-authoritative state/RLS and audit history, (4) add appropriate tests and negative cases, (5) run lint/test/build or report why not, (6) report remaining gaps. Never invent test results, product validation, user measurements or expert credentials.

**Critical safety:** no AI-created 'done' state without validated proof; no user-provided text or images treated as system directives; no unsafe instructions for regulated/hazardous work; no service-role key in browser bundles; no force push to Lovable-connected history.

---

# Existing codebase invariants (preserved from previous AGENTS.md)


## Project rules
- Plan content (steps, prereqs, proof items) lives only in `src/lib/plan.ts`; step status is always computed from prereq ID arrays in `src/lib/engine.ts`, never hard-coded — so new plans need no UI changes.
- Built-in templates are picked by `E.planForText` using whole-word match phrases (`Plan.keywords`, trailing `*` = prefix). Keep phrases specific: a miss falls back to the general AI intake, a false hit pushes the user into an unrelated plan.
- Progress is honest: `E.goalSummary` counts the Goal check as one unit, so nothing shows 100% until the check passes; the goal list shows a text status.
- Custom intake turns go through pure `E.intakeTurn`: the first user message is the goal, later texts answer the pending question or are stored as extra detail in `goals.intake`, so a retry after a failed plan uses what the user added.
- All assistant replies come from pure functions in `src/lib/engine.ts` (tested in `engine.test.ts`); UI only dispatches actions — keeps the scripted response contract testable.
- `saveChanges` first claims the change with a compare-and-set on `goals.seq`; a lost claim writes nothing and throws `StaleGoalError`, which server functions turn into the latest goal plus a notice. `copyPlan` clears debris from an interrupted first-plan attempt before inserting. Persistence tests use the in-memory fake in `src/test/fakeSupabase.ts` (no RLS modeled).
- `goals.functions.ts` is only the authenticated boundary (auth middleware + zod input). Handlers live in `src/lib/actions.server.ts` and take `Deps` (RLS client, service client, verified user id, `AiPort`, clock), so `src/test/db/journeys.test.ts` runs whole journeys on real Postgres with a scripted AI. Never let a handler take a user id from client input.
- Goal lifecycle statuses come only from pure `src/lib/lifecycle.ts`, applied in `saveWithLifecycle` (`goals.server.ts`): most are derived from stored state; `escalated`/`abandoned` are sticky and change only via explicit events; impossible moves save nothing. Code works with and without the `goals.status` column (`lifecyclePersisted`). Schema changes go in `db/proposed/` and reach the database only through Lovable; never hand-add files to `drizzle/` (see `docs/MIGRATIONS.md`).
- Goals live in Lovable Cloud. Browser reads go through server functions in `src/lib/goals.functions.ts`; every write (including marking a step done or a goal achieved) happens only there, using the engine to decide — database policies give signed-in users read-only access to their own rows (plus delete on their own goals), so the browser can never write "done" directly.
- Starting a goal copies its template into the goal's own step/prerequisite/proof-item rows; `src/lib/goals.server.ts` rebuilds an engine Goal from those rows, so later template edits never change existing goals.
- Unsubmitted answers (typed proof, ticks, Goal check inputs) stay in browser memory until submitted.
- The signed-in app lives under `src/routes/_authenticated/`; `/auth` is the only public screen.
- Photo proof values are private-storage paths (`proof-photos/{userId}/{goalId}/...`); the AI photo check in `ai.server.ts` only returns a verdict, and `submitProof` decides done. Overrides and verdicts are logged in their own tables so the trail is auditable.
- Step timers start and finish on the server (`goal_steps.timer_started_at`, `timer_done_posted`) so they survive refresh and work across devices; the engine computes remaining time from the stored start.
- Replanning: the AI only proposes a patch (`aiReplan`); `E.validatePatch` checks it in code (done steps untouched, prereqs exist, no cycles, same proof rules, nothing newly unlocked) before it is saved as a pending `plan_patches` row. Only the `applyPatch` action changes the plan, saving the old plan in `plan_revisions` first so "Restore previous plan" can bring it back via `E.restorePlan`.
- AI output is never trusted: photo-check prompts/verdict parsing live in pure `src/lib/photocheck.ts` (user text fenced in escaped <user_data>), AI text is capped by `limitWords` in `src/lib/text.ts`, and per-user limits are constants in `src/lib/limits.ts` checked in `ai.server.ts` before every call — so every rule is testable without the AI.
- AI failures and limit hits become chat messages (`aiError` with a JSON retry payload, or a rate line) via `aiFailure` in `goals.functions.ts`; `retryAi` deletes the error and echoed user text before re-running, so retries never duplicate messages.
- Agent activity events (`src/lib/activity.ts`) are display-only: the server records them around AI calls and `withActivity` saves them as one `activity` chat message (JSON in `body`) before the reply; the phase tracker and plan groups are pure helpers in `src/lib/phase.ts` — so research can add events/phases later without UI or engine changes.
