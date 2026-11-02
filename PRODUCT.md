# Stepwise — Product vision

**Category:** Outcome-oriented AI expert companion  
**Tagline:** Expert guidance, one step at a time.  
**Promise:** Stay with the user's real task: understand, guide, unblock, adapt, and verify—not just answer.

## Thesis

A normal chatbot can explain a process and leave. Stepwise should make long, uncertain, real-world work navigable. It maintains a mission-level model of the goal but reveals the **next most useful interaction**: a question, observation, experiment, instruction, decision, explanation, verification, or escalation. The visible plan graph is a living map, not a static generated checklist.

**Person + Stepwise = greater practical capability** through a collaboration of human action and AI support. It does not confer credentials or replace licensed specialists.

## Who it serves

1. **Beginners** tackling unfamiliar work who need patient, precise, accessible explanations and checks.
2. **Makers and builders** who must gather requirements, build prototypes, test, and recover from surprises.
3. **Troubleshooters** who need hypothesis-driven diagnosis without repeating failed fixes.
4. **Learners** who want teaching, practice, feedback, and demonstrated mastery.
5. **Project owners** managing multi-stage endeavors, dependencies, budgets, evidence, and change.

Start broad in capability but **ship depth in a small number of well-evaluated journeys** before claiming universal expertise.

## Non-negotiable product principles

- **Outcome over output:** a generated plan or plausible answer is not success. Define observable success criteria with the user.
- **Investigate before prescribing:** ask only questions that change the next decision; reuse known facts and avoid interrogating.
- **One useful next interaction:** not necessarily one rigid step; the user may ask for the complete map anytime.
- **Adaptive depth:** concise by default, expandable to detailed teaching, safe procedures, examples, and troubleshooting.
- **Persistent memory with provenance:** facts, user-provided observations, hypotheses, attempts, results and decisions must remain distinguishable, editable and scoped to the user's project.
- **Graph with causality:** prerequisites, alternative paths, parallel branches, failure investigations and evidence links should be explicit.
- **Failure is information:** diagnose, record outcome, update hypotheses and replan without silently erasing history.
- **Proportional verification:** quick confirmation for simple low-risk steps; stronger checks for consequential outcomes. No checkbox theater.
- **Human control:** users may pause, resume, correct memory, reject a plan, inspect why, export, or end a task.
- **Bounded expertise:** communicate uncertainty and escalate for hazards, regulated work or consequences beyond the system's evidence.

## Product loop

**Understand → Model → Guide → Observe → Verify → Adapt → Continue.**

At any point a user can ask *why*, *how exactly*, *show alternatives*, *what have we tried*, *what changed*, or *show the entire plan*. An unresolved task remains **active, waiting, blocked or paused**; it must not be declared successful merely because AI has no next message. Explicit user cancellation and legitimate impossibility are also valid outcomes.

## Signature interaction

User: "My laptop randomly shuts off."

Stepwise: "Does it lose power instantly, or show a shutdown screen?"  
User: "Instantly. Usually when gaming."  
Stepwise: explains why heat/power are hypotheses, asks for safe temperature/power observations, then guides a diagnostic the user can actually perform. If it fails, it logs the result, branches the investigation and avoids repeating that same test. It pauses or refers to a professional when necessary. It only marks the diagnosis/resolution complete when agreed checks pass.

## Experience pillars

- **Conversation:** the primary guidance surface; structured prompts and actions where useful.
- **Execution graph:** full overview, current focus, completed decisions, blocked dependencies, alternative paths.
- **Project memory:** durable facts, attempts, evidence, provenance, uncertainty, user corrections.
- **Expert modes:** explain, diagnose, teach, compare, plan, act, verify, escalate. These are interaction styles, not separate chatbots.
- **Outcome record:** evidence, open risks, user confirmations, final checks and a concise report of what changed.

## North-star outcomes and guardrails

Measure: verified goal completion; time-to-first-useful-action; percentage of stuck states recovered; repeated-question rate; failed-repair repetition rate; plan change explainability; user-rated clarity; safe escalation accuracy. Segment by journey complexity and risk. Do not optimize raw message count, number of tasks or AI-generated plans as a proxy for value.

**Guardrails:** false completion rate; unsafe instructions; unauthorized state changes; data exposure; hallucinated measurements; cost per resolved goal; model/verification latency; accessibility and mobile usability.

## Deliberate non-goals (initial releases)

- Autonomous real-world execution without user awareness/authorization.
- Guaranteed professional-grade diagnosis in every domain.
- Unattended monitoring or background progress without explicit infrastructure and consent.
- Broad third-party integrations before the core assisted journey works reliably.
- Replacing qualified electricians, engineers, physicians or other regulated professionals.

## Delivery truth

See [roadmap.md](roadmap.md) and [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md). The current repository implements **some** of these building blocks; this vision does not assert the remaining features are shipped.
