# Stepwise product roadmap

**Updated:** 2026-11-02  
**Status:** Planning baseline. Checkboxes track delivery only after code, tests and verified acceptance criteria land.  
**Source of truth:** [PRODUCT.md](PRODUCT.md) (why), [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) (behavior), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (today), this file (order).

The existing case-method backlog is preserved at [docs/legacy/case-method-roadmap.md](docs/legacy/case-method-roadmap.md), not silently discarded.

## P0 — Repo and product foundation

- [ ] P0.1 Align README, product contract, architecture, agent instructions, roadmap, security/safety and contribution docs. **Acceptance:** coherent cross-links and honest shipped-vs-planned scope. *(Proposed in this documentation PR.)*
- [ ] P0.2 Add CI for formatting/lint/tests/build; confirm it passes with a clean install. **Acceptance:** green checks on PR and protected default branch. *(Blocking lint/tests/build green on `main`; typecheck job added in #7, local Supabase job in #9; branch protection not yet verified.)*
- [ ] P0.2a Clear legacy formatting debt in a separate mechanical PR. **Acceptance:** `bun run lint` and `bun run format:check` pass without rule suppression. Original CI flagged 5,195 Prettier violations. *(#8: passes; byte-identical compiled output.)*
- [ ] P0.3 Baseline actual behavior in an authenticated Lovable/Supabase environment, list failing flows and infrastructure gaps. **Acceptance:** recorded reproducible smoke results and owners.
- [ ] P0.4 Verify tracked config contains only public values; configure secret scanning and branch protection. **Acceptance:** secrets reviewed, guardrails enabled.

## P1 — Complete one reliable outcome journey

Spec: [.kiro/specs/p1-reliable-goal-journey/](.kiro/specs/p1-reliable-goal-journey/requirements.md) (requirements, design, tasks, audit defects D1–D10). Merged: #3–#6. In review: #7–#11. The lifecycle migration ([ADR-0001](docs/decisions/0001-persisted-goal-lifecycle.md), `db/proposed/0005_goal_lifecycle.sql`) is validated in CI and waits for staging plus approval ([docs/MIGRATIONS.md](docs/MIGRATIONS.md)).

- [ ] P1.1 Instrument and test **goal → intake → plan → guide → proof → final check → result** end to end.
- [ ] P1.2 Establish clear state vocabulary: active / waiting for user / blocked / paused / achieved / abandoned / escalated. **Acceptance:** no misleading success when merely out of steps.
- [ ] P1.3 Ensure consistent retries, idempotency, transactional state transitions, error recovery and cross-device reload.
- [ ] P1.4 Make proof proportional to risk and task type instead of requiring 2–4 items for every action.
- [ ] P1.5 Ship 3 evaluated reference journeys: troubleshooting, creating something, learning a skill. Include beginner, failed-attempt and interrupted-session cases.

**Exit gate:** real users can finish those journeys without manual DB repair; evidence of outcome and failures is auditable; zero known unsafe auto-completions.

## P2 — Adaptive expert dialogue and project memory

Draft spec: [.kiro/specs/p2-agent-orchestrator/](.kiro/specs/p2-agent-orchestrator/requirements.md): one orchestrator with a deterministic next-interaction policy, project memory with provenance, attempt/hypothesis records and a real-model evaluation suite. Starts after P1 is merged and the lifecycle migration is applied.

- [ ] P2.1 Replace hard-coded universal reply-length/three-question limits with context-aware depth and clarification strategy; preserve concise defaults.
- [ ] P2.2 Build structured, project-scoped memory: facts, source, confidence, timestamps, attempts, outcomes, decisions, constraints; allow review/correction.
- [ ] P2.3 Decide the best next interaction: ask, explain, demonstrate, measure, test, reflect, escalate or continue.
- [ ] P2.4 Diagnose failures by comparing expected vs observed; record attempts and avoid repeating unchanged fixes.
- [ ] P2.5 Add explicit *why / show me how / go deeper / what have we tried / show plan* interactions and evaluation tests.

**Exit gate:** user can resume days later without re-explaining known details and can recover from a failed action with a revised diagnostic path.

## P3 — Living execution graph

- [ ] P3.1 Design versioned, validated graph schema: goals, milestones, tasks, dependencies, alternatives, evidence, branches and statuses.
- [ ] P3.2 Allow decomposition, safe rewiring, parallel tasks and investigation subgraphs; preserve done work and audit history.
- [ ] P3.3 Render zoomable accessible map with *now / next / blocked / complete* and explanation of why items are blocked.
- [ ] P3.4 Design migration from current flat steps/`step_prereqs` and patch tables; test rollback.
- [ ] P3.5 Add graph invariants: cycle detection, stable IDs, no phantom unlocks, concurrency/race safety, safe patch previews.

**Exit gate:** graph changes across user interventions without data loss or incorrect unlocks, including after reload.

## P4 — Evidence, safety and trust

- [ ] P4.1 Define verification types and criteria by consequence/risk; separate user attestation from independent machine evidence.
- [ ] P4.2 Add prompt-injection/vision test suites, data provenance and limits on AI certainty.
- [ ] P4.3 Build domain-aware risk escalation, stop-work guidance and professional referral for regulated/high-risk actions.
- [ ] P4.4 Add privacy controls for photos and sensitive project data, retention/deletion and audit log access.
- [ ] P4.5 Evaluate false-success and unsafe-instruction rates across representative scenarios.

## B — Subscription and AI cost control

- [ ] B1 Plans, server-verified entitlements, Stripe test-mode Checkout/Portal, signed idempotent webhooks, billing UI. *(This PR; migration `0006_billing.sql` proposed, not applied.)*
- [ ] B2 Credit ledger with hard limits: reserve before each AI call, settle after, refund on failure, no concurrent overspend.
- [ ] B3 Model routing modes (Fast/Smart/Expert) behind a provider abstraction, gated by entitlement.
- [ ] B4 Usage and approximate cost reporting; then top-ups and admin analytics.
- [ ] B5 Live billing: staging migration, legal/tax, live keys enabled by reviewed code change. See [docs/BILLING.md](docs/BILLING.md).

## P5 — Product quality and measured rollout

- [ ] P5.1 Accessibility, mobile usability, offline/reconnect behavior, clarity of task and evidence UX.
- [ ] P5.2 Observability: failed AI calls, plan validation errors, costs, latency, stuck/failure recovery, task outcome.
- [ ] P5.3 Controlled pilot; gather feedback and compare with a conventional chatbot baseline.
- [ ] P5.4 After proven value, consider tools, docs, search, reminders, integrations and specialized domain guidance, each with explicit authorization and safety review.

## Scope and sequencing rules

1. Avoid starting P3 graph rewrites before P1 reliability and P2 memory contract are specified.
2. Risk controls and privacy work are **cross-cutting blockers**, not optional work to leave until P4.
3. Every PR must state which roadmap item it advances, tested acceptance criteria, and remaining gaps.
4. Do not mark items done based only on AI-generated code or unit tests; use the stated exit criteria.
5. If constraints change, update this roadmap and document material architecture decisions in `docs/decisions/`.
