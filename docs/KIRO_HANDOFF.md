# Kiro Web handoff

Use [Kiro Web](https://app.kiro.dev/home) with the GitHub repository `bitpyrus/stepwise`.

1. Review [PR #2](https://github.com/bitpyrus/stepwise/pull/2) and wait for its blocking CI checks; merge it only after review. Until then the product docs and Kiro steering files live on branch `docs/stepwise-product-agent-foundation`.
2. Connect/authorize GitHub in Kiro with access to the `bitpyrus` organization and `stepwise` repository; organization approval may be needed.
3. Select the correct repository and branch. Read `AGENTS.md` plus `.kiro/steering/` and follow the product/spec/roadmap hierarchy.
4. Start with a **requirements-first spec** for a reliable end-to-end goal journey rather than trying to rewrite the entire app.

## Suggested first Kiro request

> Review AGENTS.md, PRODUCT.md, docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md, docs/UX_DESIGN.md, docs/SAFETY.md, docs/SECURITY.md and roadmap.md. We are building an outcome-oriented AI expert companion, not a static checklist. Preserve our Lovable-connected TanStack Start/Supabase app and published Git history.
>
> First validate the code lint, test and build workflow, then plan a dedicated test environment for authenticated behavior. Create a Kiro spec for P1: create goal → investigate → plan → guide → collect appropriate evidence → final goal verification → achieved or accurately unresolved. Include failure, retry, permission isolation, user correction, interrupted-session and high-risk escalation cases.
>
> Prepare requirements, architecture decisions, incremental tasks, migration/rollback strategy and measurable tests before large implementation changes. Treat durable memory, dynamic hierarchical execution graph and full adaptive diagnosis as later reviewed phases. Never let an LLM declare a task done without deterministic server validation.

## Verified handoff issues

The first CI run failed at lint due to **5,195 Prettier formatting errors** and **five no-explicit-any code errors**, preventing tests/build. The handoff branch changes five explicit-any casts, splits CI into independent lint/test/build jobs and a separately visible advisory formatting audit. Confirm subsequent checks; do not claim the code is production ready without authenticated tests.

The original tracked `.env` contains publishable Supabase configuration; it was **not** deleted or rewritten. Server secrets must remain private.

Kiro references: [Steering](https://kiro.dev/docs/steering/), [Specs](https://kiro.dev/docs/specs/), [Kiro Web](https://app.kiro.dev/home).
