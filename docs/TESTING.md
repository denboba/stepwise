# Testing and quality gates

## Run locally

```bash
bun install --frozen-lockfile
bun run lint:code   # Blocking ESLint rules (without legacy Prettier violations)
bun run typecheck   # Blocking tsc --noEmit
bun run test
bun run build
bun run lint        # Legacy strict lint; currently fails formatting
bun run format:check # Existing format debt
```

CI runs **independent code-lint, test and build jobs**. A separate advisory formatting audit reports pre-existing style debt without hiding it. The initial CI run (Nov 2, 2026) found **5,195 Prettier errors, five no-explicit-any errors and six warnings**, blocking tests/build; PR #2 fixed the `any` errors and split the jobs.

### Verified baseline (2026-11-02, `main` @ `5ae4d49`)

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | OK |
| `bun run lint:code` | 0 errors, 6 warnings (shadcn `react-refresh/only-export-components`) |
| `bun run test` | 5 files, 86 tests pass |
| `bun run build` | OK |
| `bun run format:check` | Fails: 29 files under `src/` (legacy debt, roadmap P0.2a) |
| GitHub CI on `main` | Blocking jobs pass; advisory format audit fails as designed |
| Authenticated end-to-end | **Not run** (no test Supabase project available) |

### Merged P1 increments (2026-11-02, `main` @ `a7ab85a`, PRs #3–#6)

| Command | Result |
| --- | --- |
| `bun run lint:code` | 0 errors, 6 warnings (unchanged) |
| `bun run test` | 8 files, 165 tests pass |
| `bun run build` | OK |
| `tsc --noEmit` | 88 errors, all pre-existing (no regressions from the merge) |
| GitHub CI on `a7ab85a` | Blocking jobs pass; earlier per-merge runs were cancelled by the concurrency group |

The 88 errors had one root cause each: 59 `noPropertyAccessFromIndexSignature` errors from `Record<string, unknown>` casts in `casefw.ts`, and `EvidenceRequest.validation: Record<string, unknown>` failing TanStack Start's serializable-return check, which made all five server-function handlers untyped and produced 29 follow-on errors in `goals.functions.ts`/`store.ts`. Fixed with typed casts and a `JsonValue` type; esbuild output for `casefw.ts` is byte-identical. `bun run typecheck` is now a blocking CI job.

### Stacked P1 PRs #7–#11 (2026-11-02, tip of `test/reference-journeys`)

| Command | Result |
| --- | --- |
| `bun run typecheck` | 0 errors (blocking in CI since #7) |
| `bun run lint` (strict, incl. Prettier) | 0 errors, 6 warnings |
| `bun run format:check` | passes (#8) |
| `bun run test` | 216 passed, 6 skipped (the live Supabase suite skips locally; it runs in the CI job) |
| `bun run build` | OK; client bundle contains no server-only strings (system prompt, `saveWithLifecycle`, `ai_call_logs`) |
| CI *Local Supabase integration* | 6/6 against a disposable local Supabase stack |

Not yet tested: real AI model quality (journeys use a scripted AI), manual signed-in browser use, the lifecycle migration on any Lovable database.

Defects found in the same audit are listed in [.kiro/specs/p1-reliable-goal-journey/requirements.md](../.kiro/specs/p1-reliable-goal-journey/requirements.md).

## Database tests (no production access, ever)

| Layer | Where | Runs | What it proves |
| --- | --- | --- | --- |
| In-memory fake | `src/test/fakeSupabase.ts` | every `bun run test` | write order, compare-and-set, primary keys (no SQL) |
| Real Postgres 18 (PGlite, in-process WASM) | `src/test/db/` | every `bun run test`, ~11 s | the repo's actual migrations apply in journal order; RLS on every table; no insert/update policies; cross-user reads/writes/deletes denied; owner can't set `achieved`/`done` directly; storage folder policies; server `saveChanges`/`loadGoal` journey, concurrency and interrupted-write recovery against real constraints |
| Local Supabase stack (Docker, CI job "Local Supabase integration") | `src/test/supabase/` | CI on every PR; locally with `supabase start` | real Auth (signed-in users, forged-token rejection), PostgREST + RLS, Storage API uploads/downloads between two throwaway users, two truly simultaneous saves |

`src/test/db/supabase-stubs.sql` stands in for Supabase's `auth`/`storage` schemas and **grants table privileges broadly**, as Supabase does, so the tests show that RLS (not missing grants) blocks access. Mutation check: disabling RLS on `goals`, `goal_steps` and `storage.objects` fails 10 of 16 PGlite tests.

The live suite refuses any non-`localhost` URL and fails (instead of skipping) when `SB_TEST_REQUIRED` is set without credentials. To run it locally: `supabase init && supabase start` in a scratch directory, apply `drizzle/migrations/*.sql` in journal order with `psql "$DB_URL"`, create the `proof-photos` bucket, then export `SB_TEST_URL`, `SB_TEST_ANON_KEY`, `SB_TEST_SERVICE_KEY` from `supabase status -o env`. See `.github/workflows/ci.yml`.

## Existing automated tests

- `src/lib/engine.test.ts` — prerequisite unlock rules, plan validation, proof, checks, timers, replan constraints.
- `src/lib/phase.test.ts` — display-state helpers.
- `src/lib/photocheck.test.ts` — photo verdict / trust boundary behavior.
- `src/lib/text.test.ts` — text sizing.
- `src/test/app-routing.test.tsx` — route availability.
- Review any additional new tests alongside the features they cover.

## Required test pyramid for new features

| Layer | Examples |
| --- | --- |
| Pure unit | Plan/patch validation, graph cycles, state machine, proof rules, failure diagnosis |
| Server/integration | Authenticated and unauthorized queries/writes, RLS, idempotence, persistence, simultaneous actions |
| Browser end-to-end | Auth, create, intake, plan, act, upload, verify, resume, recover, complete |
| Adversarial | Prompt injection, misleading evidence, bad models, unsafe requests, malformed JSON |
| Accessibility | Keyboard/mobile, focus, screen-reader labels, visually meaningful graph alternatives |

## Golden end-to-end paths (manual until automated)

1. **Custom goal:** create, answer intake, generate plan, start, finish evidence-backed steps, pass final goal check.
2. **Failed final check:** no false completion; diagnose and offer safe recovery.
3. **Blocked task:** prerequisites correctly prevent progress; map explains why.
4. **Replan:** failed action produces patch; pending patch visible; user applies or rejects; undo/restore preserves prior achievements.
5. **Resume:** sign out/in or switch device; all submitted progress persists, drafts do not masquerade as saved work.
6. **Photo:** authorized upload, clear/missing/unclear response, override audit, no other-user access.
7. **AI failure:** rate limit, timeout or invalid model JSON leads to recoverable UI and no partial mutation.
8. **High-risk goal:** safety guidance blocks unsafe hands-on steps and requires professional assistance.
9. **Long goal:** decomposed work remains navigable; no incorrect graph loops or phantom unlocks.

## PR evidence

Every change report must state actual commands executed, pass/fail outcomes, relevant screenshots or test logs, environments used, and limitations. A failed/unrun live flow is an **open gap**. Do not mark roadmap items done based on code compilation alone.

## Next testing tasks

- Record a CI baseline and address any existing failures separately.
- Add a disposable test Supabase project and RLS integration test harness.
- Automate browser smoke tests with a test user and isolated evidence storage.
- Track regressions in false completion, repetition, stuck recovery and safety escalation.
