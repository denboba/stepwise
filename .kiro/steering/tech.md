---
inclusion: always
---
# Technical constraints

React 19, TypeScript, TanStack Start/Router, Vite, Tailwind 4, Supabase/Lovable Cloud, Lovable AI Gateway, Vitest and Bun. Do not change frameworks or hand-edit generated integrations.

- `src/lib/engine.ts` and `plan.ts`: pure rules, prerequisites, proof and plan validation.
- `src/lib/goals.functions.ts`: authenticated server actions and authoritative mutations.
- `src/lib/goals.server.ts`: persisted goal reconstruction.
- `src/lib/ai.server.ts`: AI outputs are proposals, never authority for completion.
- `src/lib/store.ts`: query cache and unsent browser drafts.
- `src/components/stepwise/`: UI, graph and evidence.

Keep user data scoped, never ship service-role credentials, preserve Lovable-synced Git history. Use `bun run lint:code`, `bun run test`, `bun run build`; strict formatting remains tracked separately. See #[[file:docs/ARCHITECTURE.md]] and #[[file:docs/SECURITY.md]].
