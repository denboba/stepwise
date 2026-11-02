# Contributing to Stepwise

Stepwise is a private, Lovable-connected repository. Contribute through reviewed branches and pull requests; do not rewrite published Git history.

## Before coding

Read [README.md](README.md), [PRODUCT.md](PRODUCT.md), [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md), [AGENTS.md](AGENTS.md), [roadmap.md](roadmap.md) and the architecture/safety/security notes relevant to your work. Ground all "already works" assertions in actual source and tests.

## Workflow

1. Identify a roadmap issue, user-visible outcome and narrow acceptance criteria.
2. Branch from current `main` (e.g. `feat/diagnostic-history`, `fix/proof-retry`, `docs/clarify-intake`).
3. Keep changes scoped; preserve auth, engine validations, graph invariants and audit history.
4. Update or add tests for success, failure and unsafe input. Run `bun run lint:code`, `bun run test`, `bun run build`. Run `bun run format:check` for the tracked legacy formatting debt; do not add new formatting violations.
5. Open a PR using the template. Include risks, migrations, rollback strategy and manual verification status.
6. Merge after review and passing required checks. Configure branch protection in GitHub settings before enforcing this policy.

## Code conventions

- TypeScript, TanStack Start file routes, pure logic in `src/lib/engine.ts` where possible.
- Server functions own authenticated state transitions. No client-side direct DB writes to completion state.
- All AI output is advisory until schema + rules validate it.
- Reuse existing UI components and keep all paths accessible on mobile and keyboard.
- Keep generated files in `src/integrations/` and `src/routeTree.gen.ts` under tool ownership.
- Avoid adding dependencies or changing hosting/build infrastructure without an architecture note.
- Migrations require backward compatibility, data-safety review and test/rollback plan.

## Scope boundaries

Do not treat the product vision as already implemented. Do not ship unsafe expert claims or a rigid stepper that cannot handle questions and failures. Never expose secrets or evidence files; do not force-push commits synchronized with Lovable. See [docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md).

## Pull request quality bar

Reviewers should be able to answer: What user outcome improved? What was verified? What failure cases remain? What could go wrong? How do we roll back? Documentation-only PRs must be explicit that they did not test application behavior.
