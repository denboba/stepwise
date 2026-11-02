# Security and privacy baseline

This repository connects to Lovable Cloud and Supabase. Goal histories, submitted evidence and photos can be sensitive.

## Existing trust boundaries

- Browser: `src/lib/store.ts` drafts and UI; **not an authority** for marking tasks complete.
- Authenticated server functions: `src/lib/goals.functions.ts`, authenticated with `requireSupabaseAuth`; validate identity, goal ownership, input and transitions on every write.
- DB mapping: `src/lib/goals.server.ts`; user reads rely on row-level security. The `supabaseAdmin` service-role client bypasses RLS, so every admin operation must bind explicitly to authenticated user and goal.
- AI gateway: `src/lib/ai.server.ts`. Prompts and responses are untrusted; never allow a model output to perform unvalidated state transitions.
- Photos: paths scoped to a user and goal in private `proof-photos` storage; use short-lived authorized access and enforce path, MIME type and size checks.
- Existing generated integration files in `src/integrations/supabase/` should not be modified by hand.

## Secret handling

- The repository currently tracks `.env` containing **publishable** Supabase configuration; project identifiers and public publishable keys are not equivalent to service-role secrets. Still review the values and consider moving tracked public config to `.env.example` in a later reviewed migration. Do **not** expose tracked values in AI chat logs or PR descriptions.
- `SUPABASE_SERVICE_ROLE_KEY` is required by server-side service-role access; it is sensitive and must be supplied only through an approved secret manager. Never use `VITE_` for server-only secrets.
- No credentials, session tokens, private photo signed URLs, user data, personally identifying logs or model API keys in commits, screenshots, test fixtures, issue reports or analytics.
- Rotate any secret actually exposed and review repository history; adding to gitignore after the fact does not erase history.
- CI runs tests and builds without live production service-role access. Authenticated integration tests use dedicated isolated credentials with narrowly scoped permissions.

## Authorization and data lifecycle

- Enforce cross-account isolation (read, write, delete, upload, AI context, replan, restore, export).
- Validate reference IDs, JSON schemas and file paths server-side; avoid trusting just a user-submitted goal ID.
- Treat documents, tool output, photos and chat messages as untrusted data (prompt injection).
- Avoid leaking private projects in logs and AI error messages; redact sensitive content by default.
- Add user-facing correction/export/deletion policies for persistent mission memory before launching durable memory.
- Plan and verify retention, consent and access controls for evidence, uploaded files and model provider processing.

## Required security checks

- Cross-user goal, proof and photo access denied.
- No unauthorized `done` / `achieved` transitions through direct API requests.
- Duplicate submissions/races do not incorrectly increment evidence or unlock steps.
- Malformed AI graph/patch output rejected; no cycles or missing prerequisites.
- Model fails closed on unclear photo check; user can request safe review.
- Secret and dependency scanning enabled in repository settings where available.

## Disclosure

Report security vulnerabilities privately to repository maintainers. Do not publish exploit details or secrets in public issues. Related: [SAFETY.md](SAFETY.md), [ARCHITECTURE.md](ARCHITECTURE.md).
