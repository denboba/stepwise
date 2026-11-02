# Stepwise

**Expert guidance, one step at a time.** An AI partner that helps people turn real-world goals into verified results—not a chatbot that merely describes what to do.

> **North star:** Plan globally. Guide contextually. Remember continuously. Adapt intelligently. Verify outcomes.

Stepwise asks useful questions, maintains a living dependency graph, explains and demonstrates the next action at the level the person needs, remembers what happened, detects when something fails, and replans without losing completed work. The person supplies context, judgment, observations, and real-world actions; Stepwise supplies structured assistance. Expert-level guidance does **not** imply professional licensing, guaranteed correctness, or permission to attempt hazardous work.

## Project status

**Early working foundation; not yet production-validated.** The repository includes authenticated goals, goal conversations, built-in templates, AI-created plans, step prerequisites, evidence collection (including photos), timers, plan patch proposals, an execution map, and a final goal check. The most recent PR explicitly did **not** verify a full build or authenticated end-to-end flow. Do not claim the envisioned adaptive expert system is already complete.

The current implementation still has a fixed 4–10-step AI plan schema, short reply limits, and limited intake questions. Hierarchical/dynamic graphs, durable structured memory, rich instruction modes, robust failure diagnosis, and proportional verification are **planned work**, not shipped capabilities.

## Start here

| Document | What it contains |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Mission, audience, differentiators, product principles, success criteria |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Expected experience, contract, states, scenarios, acceptance criteria |
| [roadmap.md](roadmap.md) | Prioritized, dependency-aware engineering plan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Actual code ownership, request paths, important invariants |
| [AGENTS.md](AGENTS.md) | Mandatory instructions for coding agents |
| [docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md) | How agents should scope, implement, verify, and hand off work |
| [docs/SAFETY.md](docs/SAFETY.md) | Boundaries for physical, medical, legal, financial, and other high-stakes tasks |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, tenancy, secrets, data handling |
| [docs/TESTING.md](docs/TESTING.md) | Quality gates and end-to-end scenarios |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development/PR workflow |
| [docs/UX_DESIGN.md](docs/UX_DESIGN.md) | UI/UX design direction |
| [docs/KIRO_HANDOFF.md](docs/KIRO_HANDOFF.md) | Kiro Web setup and implementation handoff |

## Stack

React 19 + TypeScript; TanStack Start/Router; Tailwind CSS 4 + shadcn/Radix; TanStack Query; Supabase/Lovable Cloud for auth, database and private photo storage; Lovable AI Gateway for generation; Vitest/React Testing Library; Bun + Vite. This is a **TanStack Start application**, not a Next.js project.

## Local setup

Requirements: Bun, Git, and access to a configured Lovable Cloud/Supabase project for authenticated live workflows.

```bash
git clone https://github.com/bitpyrus/stepwise.git
cd stepwise
bun install --frozen-lockfile
bun run dev
```

The repository already contains a Lovable-managed `.env` with **publishable** Supabase configuration. See [docs/SECURITY.md](docs/SECURITY.md) before changing it. The backend also requires `SUPABASE_SERVICE_ROLE_KEY` in the server's **private** environment for authenticated server operations; never prefix it with `VITE_` or commit it. Use Lovable Cloud configuration or your approved secure server environment. Local sign-in, proof uploads, and AI calls require correctly configured services.

```bash
bun run lint:code    # CI blocking code lint
bun run test
bun run build
bun run lint         # Strict code + formatting (known legacy debt)
bun run format:check # Legacy formatting audit
```

These are validation commands, **not a claim that they currently pass**. The original CI failure showed extensive pre-existing formatting errors; CI now separates the strict formatting audit from blocking code lint, tests and build. See [docs/TESTING.md](docs/TESTING.md) for the live test matrix and expected CI behavior.

## Code orientation

- `src/components/stepwise/` — chat, cards, progress, dependency map.
- `src/routes/_authenticated/` and `src/routes/auth.tsx` — authenticated application and public sign-in.
- `src/lib/engine.ts` and `src/lib/plan.ts` — pure goal transitions, plan data, prerequisites, proof and patch validation.
- `src/lib/goals.functions.ts` — authenticated mutation/query boundary; `goals.server.ts` — database mapping.
- `src/lib/ai.server.ts` — server-only AI calls, schemas, and limits.
- `src/lib/store.ts` — client queries, ephemeral draft evidence, UI actions.
- `src/lib/casefw.ts` — unfinished case-method groundwork; do not assume it is wired into the product.
- `src/integrations/` — Lovable/Supabase integration; some files are generated.
- `drizzle/migrations/` — database migration history; `src/integrations/supabase/types.ts` — database types.

## How to contribute

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before changing any behavior. Work on a feature branch, keep changes small, update tests and docs with behavior changes, and use the PR template. Existing Lovable-connected history must not be force-pushed or rewritten.

Development in [Lovable](https://lovable.dev/projects/7c17d4e0-39b0-435a-809a-707235c3e5bd) remains available; GitHub and Lovable sync, so review integration-sensitive changes carefully.

**License:** No open-source license is declared in this repository; do not assume redistribution rights.
