# P2 — Agent Orchestrator: design (draft)

## Turn pipeline

```text
user message / action
  1. life-safety gate (safety.ts)                         code, no AI
  2. lifecycle guard (lifecycle.actionAllowed)            code
  3. intent classification                                 code first (regex/keywords as today),
                                                           model fallback returns an enum only
  4. policy.decide(state, memory, intent) → TurnType       pure, tested
  5. context = memory.select(goal, turnType)               code, size-capped, untrusted data fenced
  6. model call in the TurnType's mode → JSON proposal     ai.server.ts via AiPort
  7. validate(proposal, state, memory)                     code: schema, safety tier, repeats,
                                                           patch rules, length limits
     invalid → one retry with errors → else safe fallback line
  8. apply: engine transition + memory writes + attempts   saveWithLifecycle (single commit)
  9. reply rendered from validated data                    UI
```

Everything after step 6 treats model output as a proposal. Steps 1–5 and 7–8 are deterministic and unit-testable. The existing `AiPort`/`Deps` seam (`actions.server.ts`) is where the orchestrator plugs in. `dispatch` becomes `orchestrate`, one turn type at a time, so existing behavior can be migrated incrementally behind the same tests.

## Policy (pure)

```ts
type TurnType = "ask" | "explain" | "instruct" | "observe" | "diagnose" |
                "propose_change" | "verify" | "escalate" | "acknowledge";
decide(goal: Goal, memory: Memory, intent: Intent): { type: TurnType; why: string }
```

Rules, in order: safety → lifecycle → user intent (why/how/stuck/it failed/correct) → missing plan-critical facts → open observation → next instruction → verification. `why` is stored with the turn for debugging and the "Why now?" affordance.

## Memory model (proposed tables, additive; via `db/proposed/` and MIGRATIONS.md)

```sql
goal_facts(id, goal_id, user_id, key, value jsonb, kind, source, confidence numeric,
           supersedes uuid null, created_at, deleted_at null)
goal_attempts(id, goal_id, user_id, step_key, action_taken, expected, observed,
              outcome, evidence jsonb, created_at)
goal_hypotheses(id, goal_id, user_id, statement, status, evidence_for jsonb,
                evidence_against jsonb, created_at, updated_at)
```

RLS: select own rows; no insert/update policies (server writes only), the same as today. Deletion: soft delete with `deleted_at` so corrections keep history, plus hard delete on goal delete (cascade). Intake answers migrate into `goal_facts` with `source = user_said` (backfill from `goals.intake`).

## Validators to add (pure)

- `validateTurn(type, proposal)`: JSON schema per mode, length caps from R2, required fields.
- `noRepeatQuestion(question, memory)`: key overlap with known facts → reject.
- `noRepeatFailedFix(proposal, attempts)`: same action on the same step with outcome `failed` and no changed fact since → reject.
- `tierCheck(proposal, frame)`: reuse `casefw` tier-3 forbidden patterns on instructions.
- `memoryWrite(proposal)`: only `ai_inferred` source from the model; can't supersede `user_said`/`measured`.

## Evaluation harness

Extend `src/test/db/journeys.test.ts`:

- `scenarios/*.ts`: user persona + scripted user replies + expected properties (not exact text).
- CI: scripted AI (deterministic).
- `bun run eval` (manual, opt-in, needs a Lovable AI Gateway key in the local env, never in CI secrets for PRs): the same scenarios with the real `ai.server.ts`, transcript written to `eval-results/` (gitignored), metrics from R8 printed and compared to the last baseline.

## Migration order

1. Policy + validators with no schema change, using intake/messages as memory (compatible).
2. `goal_facts` + correction UI.
3. `goal_attempts`/`goal_hypotheses` + diagnose turn type.
4. Adaptive depth (raise caps behind validators).
5. Tier-3 professional preparation.

## Risks

- Prompt-injection surface grows with memory. Mitigation: fenced untrusted data, model can't write non-inferred facts, validators on every proposal.
- Cost/latency: one model call per turn as today, plus an optional intent fallback. Track in R8.
- Over-asking vs under-asking: measured by repeated-question rate and turns-to-first-action, not by intuition.
