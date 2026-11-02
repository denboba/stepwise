# Architecture: current code versus target

**Current** as inspected on 2026-11-02, `main` at `99f9fd5`. This describes deployed-code intent, not an audited production deployment. For target behavior see [PRODUCT_SPEC.md](PRODUCT_SPEC.md).

## Current stack and request flow

```text
Browser: TanStack Start + React
  App.tsx / Cards.tsx / PlanMap.tsx
       | useStepwise (store.ts, TanStack Query, local draft input)
       v
Authenticated server functions (goals.functions.ts)
  | auth middleware + schema validation + server-side rule engine
  |-- goals.server.ts <--> Supabase goals, steps, prereqs, proof, chat, patch rows
  |-- ai.server.ts <--> Lovable AI Gateway (intake, plan, hint, photo, replan)
  |-- storage: private photo paths / signed access
  v
Returns updated Goal snapshot --> UI re-renders
```

## Ownership map

| Concern | Primary owner |
| --- | --- |
| App shell / conversation | `src/components/stepwise/App.tsx` |
| Evidence, tasks, goal checks | `src/components/stepwise/Cards.tsx` |
| Dependency visualization | `src/components/stepwise/PlanMap.tsx` |
| UI activity / phases | `src/components/stepwise/Progress.tsx`, `src/lib/phase.ts` |
| In-memory client drafts + query cache | `src/lib/store.ts` |
| Plan templates + types | `src/lib/plan.ts` |
| Pure transitions, status/proof/patch validators | `src/lib/engine.ts` |
| Authorization + orchestration + writes | `src/lib/goals.functions.ts` |
| Database mapping and persistence | `src/lib/goals.server.ts` |
| AI prompts, model calls, limits | `src/lib/ai.server.ts`, `src/lib/limits.ts` |
| Safety/case-method utilities in progress | `src/lib/casefw.ts` |
| Supabase/Lovable integration | `src/integrations/`; some files generated |
| DB migrations/types | `drizzle/migrations/`, `src/integrations/supabase/types.ts` |
| Tests | `src/lib/*.test.ts`, `src/test/*.test.tsx` |

Public route: `/auth`. The actual application is under `src/routes/_authenticated/`; its route guard disables SSR and checks the logged-in user. See `src/routes/README.md` for routing conventions. Do not create Next.js-style paths.

## Current invariants — preserve during refactors

1. **Server is authoritative for goal changes.** Client drafts do not mark steps done. Authenticated server functions validate actions, then persist.
2. **The engine decides progression.** Prerequisite graph and completion rules come from pure functions in `engine.ts`, not UI state.
3. **One user's goal stays isolated.** Browser reads are RLS-governed. Service-role operations are server-side only; scope every mutation to authenticated user/goal.
4. **Plans are goal-owned snapshots.** Editing templates must not retroactively mutate existing goals.
5. **AI proposes, rules decide.** Validate generated plans, evidence, photo verdicts and patches in code. A model is not the final authority.
6. **Replanning is auditable.** Pending patch → validation → explicit application → revision stored; restore history where allowed.
7. **Timer/photo handling is persistent and private.** Timers are server-owned; photo objects are scoped to user and goal; avoid publicly accessible proof URLs.
8. **Lovable history is connected.** No force pushes or rebasing published commits; avoid editing generated integration files.

## Current shortcomings relative to vision

- Mostly flat step dependencies and a map; no hierarchy, branch-aware diagnostics, or sophisticated graph history.
- AI plan constrained to 4–10 steps with fixed proof count; prompt and UI impose short output limits.
- Custom intake capped at three questions; no robust durable project fact/attempt memory model beyond current goal/chat structures.
- Progression does not yet implement the full lifecycle in PRODUCT_SPEC.
- Case-method code/roadmap exists but some planned stages are not integrated.
- Repository's latest PR did not run a full build or authenticated UI verification; CI is proposed but not verified.

## Proposed evolution (design before implementation)

Add versioned **goal state / memory / graph / evidence / observations** contracts with explicitly validated transitions. Prefer incremental adapters from existing `goal_steps` / `step_prereqs` / `plan_patches` rather than a rewrite. Keep a pure deterministic core so model output cannot bypass constraints. Ensure cross-device resume and correction/deletion controls. Any database change needs migration, rollback path, RLS validation and tests.

Before implementing a structural change, write a short decision record in `docs/decisions/` stating rationale, alternatives, data migration and risks.
