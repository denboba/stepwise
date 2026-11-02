# P2 — Agent Orchestrator: tasks (draft)

Start only after P1 PRs #7–#11 are merged and the lifecycle migration is applied. Each increment is one PR with scripted-journey coverage; prompt/policy PRs also attach a real-model eval transcript (R8).

## O1 — Evaluation first · R8

- [ ] O1.1 Scenario format + 6 scenarios (laptop shutdown, router drops Wi-Fi, LED build, shelf install (tier 2), learn saxophone, "replace a wall socket" (tier 3)).
- [ ] O1.2 Metrics: repeated question, repeated failed fix, false completion, unsafe instruction, turns to first action, invalid proposals.
- [ ] O1.3 `bun run eval` with real model (opt-in, local only), transcripts gitignored, baseline file committed.

## O2 — Policy and validators, no schema change · R1, R2, R5

- [ ] O2.1 `src/lib/orchestrator/policy.ts` `decide()` + exhaustive tests.
- [ ] O2.2 Intent classification (code rules; enum-only model fallback).
- [ ] O2.3 `explain`/"Show me how" turn: longer validated answers in step context; UI "More detail".
- [ ] O2.4 Replace fixed intake cap with plan-critical-facts rule (max 6).
- [ ] O2.5 Route existing `dispatch` branches through `orchestrate()` without behavior change (journeys stay green).

## O3 — Project memory · R3 (migration via db/proposed)

- [ ] O3.1 ADR-0002 + `0006_goal_facts.sql` + PGlite tests (backfill from `goals.intake`, RLS, rollback).
- [ ] O3.2 Memory selection for prompts; untrusted fencing.
- [ ] O3.3 Memory panel: view, correct, delete; provenance labels.
- [ ] O3.4 `noRepeatQuestion` validator.

## O4 — Diagnosis · R4

- [ ] O4.1 `0007_attempts_hypotheses.sql` + tests.
- [ ] O4.2 Record attempts on "It failed"/failed checks; hypothesis proposals validated.
- [ ] O4.3 `noRepeatFailedFix` validator; discriminating-test turn.
- [ ] O4.4 "What have we tried?" view.

## O5 — Evidence and safety tiers · R6, R7

- [ ] O5.1 Verification method per step; proportional proof (P1 R7).
- [ ] O5.2 Tier-3 professional-preparation flow using `casefw` validators.

## Exit gate

Scripted suite green; real-model suite with false completion = 0, unsafe instruction = 0, repeated failed fix = 0, repeated question ≤ 5% of turns, on all scenarios.
