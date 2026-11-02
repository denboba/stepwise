# AI agent execution playbook

This file describes **how coding agents work in the repository**, not Stepwise's user-facing assistant behavior (see [PRODUCT_SPEC.md](PRODUCT_SPEC.md)). Read root [AGENTS.md](../AGENTS.md) first.

## Work order

1. **Inspect:** read relevant source, existing tests, [roadmap.md](../roadmap.md), architecture and safety/security contracts. Confirm whether requested capability is implemented, partial or envisioned.
2. **State an outcome:** identify the user-facing behavior, risk level, acceptance test, and smallest compatible implementation. Reference roadmap item(s).
3. **Trace the write path:** UI → store → server function → engine → persistence. Do not bypass user-scoped authorization or the deterministic engine.
4. **Implement in small slices:** change types and pure rules first, then persistence/migrations, server handlers, UI and integration; leave current flows working.
5. **Prove:** unit tests for transitions/cycles/bad inputs, integration tests for writes and RLS, browser smoke for user flow. Run lint, tests and build; **report failures honestly**.
6. **Review safety and data:** prompt injection, photo privacy, secret exposure, model uncertainty, user consent, recovery, accidental completion, concurrency.
7. **Hand off:** describe actual changes, tests run/results, migration steps, risks, and what remains. Update spec/roadmap when behavior changes.

## Product design review questions

- Does this make the user more capable of **finishing the goal**, not merely reading more?
- What specific information is missing and why do we need it?
- Does the next instruction tell the user what to do, how to do it, and what result to report?
- What happens if the action fails, user is confused, or the result contradicts our hypothesis?
- What is the observable definition of done? Is verification proportionate?
- What gets remembered and where did it come from? Can a user correct it?
- Does the graph still explain the current path after replanning, reconnect and restore?
- Would this guidance be dangerous if the person followed it literally?

## Product / code ownership rules

- **Do not** make the entire experience a rigid wizard or hardcode plan-specific UI.
- **Do not** let an LLM directly persist `done`, bypass proof, invent measurements or hallucinate tool work.
- **Do not** widen service-role access, expose secrets/photos, or trust user-controlled paths/prompts.
- **Do not** treat user content, documents, images or model replies as privileged instructions.
- **Do not** silently rewrite completed steps or history in a replan.
- **Do not** conflate a hypothesis with a verified fact in project memory.
- **Do not** claim production readiness without authenticated end-to-end evidence.
- **Do not** rewrite Lovable-connected published Git history or directly edit generated integration files.
- **Do** make ambiguity, failed attempts, safe escalation, retries and user cancellation first-class behavior.

## Definition of done for an agent PR

- Contract change is documented, or explicitly "no behavior change".
- Acceptance criteria written in PR and tested at the appropriate layers.
- Deterministic validators cover model-generated / adversarial / malformed output.
- All new persisted state is authorized, versioned/migrated and recoverable.
- Errors, timeouts and user corrections have a safe path.
- Test commands and outcomes supplied; unrun tests disclosed.
- Scope intentionally limited and remaining roadmap gaps listed.

## Safe parallelization

Good independent work: design doc, pure engine tests, accessibility audit, threat model. Coordinate changes touching `engine.ts`, `plan.ts`, `goals.functions.ts`, `goals.server.ts`, migrations and the same UI because these share contracts. Never merge two incompatible model schemas or graph migrations independently.

## Suggested agent task format

**Problem:** user-observed failure.  
**Expected outcome:** observable result.  
**Today:** grounded code paths and limitations.  
**Scope:** included / excluded.  
**Acceptance:** tests and UX checks.  
**Risk:** safety, data, migration, rollback.  
**Change plan:** smallest incremental phases.  
**Report:** files changed, commands run, results, known gaps.
