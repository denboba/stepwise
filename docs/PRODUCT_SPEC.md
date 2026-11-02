# Product behavior specification (target; not all implemented)

See [PRODUCT.md](../PRODUCT.md) for intent and [ARCHITECTURE.md](ARCHITECTURE.md) for the current implementation. Treat this document as **acceptance-oriented design**, not a statement of shipped features.

## Primary job

For a real-world goal, Stepwise should help the user take the next appropriate action until the **agreed outcome is verified** or the user explicitly pauses, ends or escalates the work. No fabricated completion, background action, measurements or tool use.

## Conversation contract

1. **Establish outcome:** capture what the person wants, practical constraints, their experience, what tools/access they have, measurable success conditions, relevant risk.
2. **Ask high-value questions:** each question should narrow a decision or improve safety; consolidate easy questions, don't repeat answered ones, and distinguish unknown from assumed facts.
3. **Plan privately, reveal progressively:** compute a mission-wide structure; present the next useful interaction. The person can open the map or full plan any time.
4. **Guide with appropriate detail:** give safe, actionable instructions and expected observation. Answer *how* and *why* with depth if asked. Never force arbitrary word counts.
5. **Observe:** ask the person to report the result, measurement, screenshot/photo or a check appropriate to the action. Label self-report vs independent verification.
6. **Diagnose failure:** compare observed vs expected, consider alternatives, propose the smallest discriminating test, track attempts and their outcomes.
7. **Replan transparently:** show what changed and why; preserve verified work, history, consent and graph invariants. User approves consequential replans.
8. **Finish honestly:** success is an outcome check, not just completed messages or checkboxes. On uncertainty, blockage, risk or cancellation, record an accurate non-success status.

## Example: unexpected laptop shutdown

Goal: prevent unexplained shutdowns during normal use. Assistant asks whether shutdown is instant, during load, with error message, etc. It uses answers to choose a safe diagnostic and tells the user exactly what observation to report. If a test fails, it records that result and branches; it does not recommend invasive electrical repair to an unqualified user. Resolution: user-observed stability under agreed conditions, with any residual uncertainty stated. If diagnosis remains uncertain, mark **unresolved/escalated**, not achieved.

## Goal lifecycle (target)

| Status | Meaning | Transition rule |
| --- | --- | --- |
| draft | Goal captured; not sufficiently scoped | Start intake |
| understanding | Gathering high-value missing context | Facts adequate → planning; safety concern → escalated |
| planning | Graph and checks being generated/validated | Valid plan → active |
| active | Action available or being performed | Observation → verifying; failure → diagnosing |
| waiting | Needs user, tool, service, elapsed time or external input | Input received → active |
| diagnosing | Expected/observed mismatch or user reports failure | New evidence → updated plan |
| blocked | Cannot proceed for a reason | Resolve blocker or revise |
| paused | User intentionally suspends work | Resume with preserved memory |
| verifying | Testing stated outcome or milestone | Passed → achieved; failed → diagnosing |
| achieved | Agreed outcome demonstrated to required confidence | May reopen if new evidence warrants |
| escalated | More qualified help or safety review required | Resume only when safe/authorized |
| abandoned | User intentionally ends goal without success | Final, with reason |

Current code has different, narrower fields (`planned`, `started`, `paused`, `achieved`) and step states (`locked`, `available`, `done`). **Do not implement the target state table as superficial UI labels**. Design persisted state machine, migrations and transition tests first.

## Execution graph contract (target)

A mission graph includes stable IDs for milestones/tasks/decisions/diagnostics; typed dependency edges; optional alternative/parallel branches; explicit status and blocking reason; estimated time/resources; safety tier; expected observations; check method; evidence links and revision history. A plan may be small or large; subplans should be lazy where appropriate.

**Invariants:** acyclic prerequisite edges; references exist; no unapproved rewriting of verified history; completed evidence remains attributable; retries do not duplicate actions; concurrent writes do not unlock impossible steps; every impactful graph mutation is validated server-side; user can see *why now?* and *what changed?*.

## Memory contract (target)

Store structured facts with `value`, `source` (user statement, measurement, external data, model hypothesis), `confidence`, `time`, `scope`, and optional `supersedes`. Store attempts and results separately from facts. Reuse relevant context but permit edits, corrections and deletions; avoid retaining sensitive data without purpose. Model output must not silently overwrite a measured value.

**Example:** "Sensor always reads 100%" is an **observation**, not proof the sensor is defective. "Sensor is defective" is a **hypothesis** until checked.

## Verification contract (target)

Choose the lightest credible method for each action: simple user confirmation, structured observation, numeric threshold, photo review, independent programmatic test, or professional sign-off. For photo AI verdicts, report *visible evidence only* and allow *unclear*. Goal success criteria are user-visible, achievable, testable and risk-calibrated. A false positive is more serious than needing another question.

## Interaction affordances

Persistent action composer; *Show graph*, *Explain why*, *Teach me*, *More detail*, *I tried it*, *It failed*, *I'm stuck*, *Pause*, *Resume*, *Correct information*, *What changed?*, *End goal*. Optional actions must have accessible text equivalents. On mobile, the next action and current graph position remain easy to find.

## System boundaries

AI may **propose** questions, plans, hypotheses, checks and explanations. Deterministic domain rules, permission checks and audited server functions control stored state, proof decisions and graph mutations. Users perform real-world actions. No task is marked achieved on model confidence alone. See [SAFETY.md](SAFETY.md) and [SECURITY.md](SECURITY.md).

## Reference acceptance scenarios

- **New user:** enters an unfamiliar goal; is not overwhelmed with a wall of instructions; understands the first safe next action.
- **Expert user:** supplies precise constraints; receives fewer redundant questions and sufficient technical detail.
- **Stuck user:** says "I don't understand"; gets a deeper explanation and can resume the same task.
- **Failure:** reports an attempted fix failed; assistant records it, asks a discriminating question and changes course.
- **Resume:** returns after sign-out or device change; facts, graph, attempts and evidence persist as expected.
- **Replan:** change of budget/resources invalidates a path; system proposes and validates a diff while preserving done steps.
- **Outcome:** all steps ticked but final check fails; status remains unresolved with recovery path.
- **High risk:** asks for hazardous electrical work; stop-work/professional guidance takes precedence.
- **Privacy:** attempts cross-account data access; authorization blocks reads/writes and private photos.
- **AI unavailable:** no silent success; user sees a recoverable error with retry strategy.
