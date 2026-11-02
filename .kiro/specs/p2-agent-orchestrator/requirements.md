# P2 — Stepwise Agent Orchestrator: requirements (draft for review)

**Roadmap:** P2.1–P2.5, with hooks for P3 (graph) and P4 (evidence). **Status:** draft; no code yet. **Depends on:** P1 PRs #7–#11 merged and the lifecycle migration applied (ADR-0001).

**One orchestrator, not a multi-agent system.** A single server-side orchestrator decides the _kind_ of next interaction with deterministic rules, asks the model for content in one of a small set of typed modes, and validates every proposal in code before anything is stored or shown. "Expert roles" are prompt framings inside that one loop. More agents can be considered only after the eval suite (R8) shows a measured gap.

## What exists today (grounded in code)

| Capability    | Today                                                                                        | Limit that hurts users                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Investigation | `aiIntake`, ≤ 3 questions, ≤ 15 words each (`MAX_INTAKE_QUESTIONS`, `INTAKE_QUESTION_WORDS`) | Fixed cap regardless of complexity; answers stored only as Q/A text                          |
| Teaching      | `aiSideQuestion` ≤ 25 words; `aiHint` ≤ 25 words; static `why` per step                      | No "show me how", no deeper explanation, no examples                                         |
| Memory        | `goals.intake` Q/A list, messages, proof values                                              | No structured facts, provenance or corrections; the AI sees only goal text + intake          |
| Diagnosis     | Replan question with fixed chips → `aiReplan` patch, validated by `validatePatch`            | No record of hypotheses or attempts; nothing prevents re-proposing a fix that already failed |
| Graph         | Flat steps + prerequisites; patch/restore with revisions                                     | No milestones, branches or diagnostic subgraphs (P3)                                         |
| Evidence      | Proof items; AI photo verdict; Goal check                                                    | 2–4 items per step regardless of risk (P1 R7)                                                |
| Safety        | Code life-safety gate + escalated status (P1)                                                | Tier-3 domains (`riskMatches`) not wired                                                     |
| Harness       | `AiPort` + scripted journeys on real Postgres (`journeys.test.ts`)                           | No evaluation with a real model                                                              |

## Requirements

### R1 — Next-interaction policy

**Story:** As a user, I get the single most useful next interaction, not a wall of steps or an unnecessary question.

1. THE SYSTEM SHALL choose each turn's interaction type from a fixed set: `ask`, `explain`, `instruct`, `observe`, `diagnose`, `propose_change`, `verify`, `escalate`, `acknowledge`.
2. The choice SHALL be made by a pure, tested policy function over goal state, memory and the user's message intent. The model may _suggest_ a type; the policy decides.
3. WHEN a needed fact is already in memory THE SYSTEM SHALL NOT ask for it again (repeated-question rate = 0 in scripted evals).
4. WHEN the user asks _why_, _how_, _show me_ or _I don't understand_ THE SYSTEM SHALL answer in the context of the open step and then return to it, without changing progress.
5. Every turn SHALL end with one clear next action or question for the user, or an explicit terminal state.

### R2 — Adaptive depth (replaces fixed word caps)

1. Default replies stay concise (≤ 60 words outside cards).
2. WHEN the user asks for more detail, or memory marks them a beginner for this topic, THE SYSTEM SHALL allow longer structured explanations (steps, example, common mistakes), capped by a server limit (≤ 400 words) and rendered progressively ("More detail").
3. Intake SHALL stop when the plan-critical facts listed by the policy are known, up to a hard maximum of 6 questions; easy questions may be combined.

### R3 — Project memory with provenance

**Story:** As a returning user, I never re-explain my setup, and I can correct what Stepwise believes.

1. THE SYSTEM SHALL store facts as `{ key, value, kind: fact|constraint|preference|equipment|skill, source: user_said|measured|photo_verified|ai_inferred|external, confidence, created_at, supersedes? }`, scoped to one goal (and later, opt-in, to the user).
2. AI-inferred items SHALL be labelled hypotheses and SHALL NOT overwrite a user-stated or measured value.
3. Users SHALL be able to view, correct and delete memory items; a correction supersedes and keeps history.
4. The model's context SHALL be built from memory by code (relevant items, newest first, size-capped), with user content fenced as untrusted data (as `photocheck.ts` already does).

### R4 — Failure diagnosis

1. THE SYSTEM SHALL record each attempt as `{ step, action_taken, expected, observed, outcome: worked|failed|partial|unclear }`, linked to evidence where available.
2. WHEN observed ≠ expected THE SYSTEM SHALL record competing hypotheses with status `open|ruled_out|confirmed` and propose the smallest discriminating test.
3. THE SYSTEM SHALL NOT propose a fix already recorded as failed unless the conditions changed (validated in code by comparing against attempts).
4. Hypotheses become facts only through evidence, never by model assertion.

### R5 — Plan changes stay validated

1. All graph changes SHALL keep going through `validatePatch` / `restorePlan` rules (done work untouched, no cycles, no phantom unlocks, no weakened proof).
2. A diagnostic test may be added as a temporary step linked to a hypothesis; P3 replaces this with branches.
3. THE SYSTEM SHALL show _what changed and why_ for every applied change (existing patch card + linked hypothesis).

### R6 — Evidence and verification

1. Each step SHALL declare a verification method: `self_report | structured_observation | numeric_threshold | photo_review | goal_check | professional`, chosen by risk (P1 R7).
2. Photo review stays verdict-only; "unclear" is allowed; the server decides.
3. The labels the user sees SHALL distinguish self-report, AI-reviewed photo and verified measurement.

### R7 — Safety tiers in the loop

1. Tier-3 domains (`casefw.riskMatches`) SHALL switch the policy to _prepare for a professional_: questions to ask, documents to gather, safe observations only. Enforced by `validateBrief`-style checks on every instruction.
2. The life-safety gate (P1) stays first in the pipeline.

### R8 — Evaluation before expansion

1. A scenario suite SHALL run every journey through the real handlers with (a) scripted AI in CI and (b) a real model behind an opt-in flag outside CI, with a recorded transcript.
2. Measured per run: repeated-question rate, repeated-failed-fix rate, false completion (must be 0), unsafe instruction (must be 0), turns to first useful action, invalid-proposal rate, tokens/latency.
3. A change to prompts or policy SHALL NOT merge if (b) regresses false completion, unsafe instruction or repeated-failed-fix on the suite.

## Non-goals (P2)

Multiple autonomous agents, web research, cross-goal user profile, tool execution on the user's behalf, voice. Each needs its own reviewed spec.
