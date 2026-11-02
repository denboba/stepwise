# Database migrations: how they reach Lovable Cloud, and how we change the schema safely

## What Lovable does (from its documentation, checked 2026-11-02)

Source: [Lovable docs, Database → "How Lovable changes your database structure"](https://docs.lovable.dev/features/database.md) and [Backend permissions](https://docs.lovable.dev/integrations/cloud).

- When you ask for a schema change **in the Lovable project chat**, Lovable makes the change, records it as a SQL file in `drizzle/migrations/`, and updates the generated types (`src/integrations/supabase/types.ts`). It uses Drizzle to create and apply these files.
- Lovable says it maintains the `drizzle/` folder (including `drizzle/schema.ts`) and `drizzle.config.ts`, and asks that they be left as they are. Our history agrees: every file in `drizzle/` was committed by `gpt-engineer-app[bot]`, the snapshots are intentionally blank, and `drizzle.config.ts` reads a Lovable-held `LOVABLE_DB_MIGRATION_URL` that isn't in this repository.
- By default, Lovable refuses backward-incompatible changes (dropping or renaming a table/column, changing a type, adding a required column without a default). The *Execute backward incompatible database migrations* permission controls this; *Ask each time* makes Lovable show the SQL first.
- **The project has a single database.** Drafts use the same database, and the Database view and SQL editor edit the database the published app uses. There is no built-in staging database.
- Backups: one per day, kept about 14 days, restore is whole-database and can't be undone. Exports are full `pg_restore` archives.

**Not documented:** whether Lovable applies a SQL file that arrives in `drizzle/migrations/` through a GitHub push rather than its own chat. Treat it as unknown. **We therefore never add files to `drizzle/migrations/` by hand.** Proposed migrations live in `db/proposed/` until applied through Lovable.

## Procedure for a schema change

1. **Propose in a PR.** Put `NNNN_name.sql` and `NNNN_name.down.sql` in `db/proposed/`. Additive only (new nullable columns or columns with defaults, new tables, new constraints that existing rows satisfy). Code in the same PR must work **with and without** the change (see `lifecyclePersisted` in `goals.server.ts`).
2. **Validate in CI, never on production.**
   - `src/test/db/*.test.ts` (PGlite, PostgreSQL 18) applies the real `drizzle/migrations/` history, seeds data through the app's own save path, applies the proposed file, then checks backfill, constraints, RLS, idempotence and rollback.
   - The *Local Supabase integration* CI job runs against a disposable local Supabase stack.
3. **Staging (recommended before the first production migration).** Lovable has no staging environment for one project. Two options:
   - **Remix the Lovable project** into a separate staging project with its own Cloud database, apply the change there through the staging project's chat, and smoke-test it.
   - Or a separate Supabase project under our control, with migrations applied via `psql` in order.
   Either way: no production user data. Use seeded test accounts.
4. **Production.** Export the database first (Database → Manage → Settings → Export). Then, in the **production** Lovable project chat, ask Lovable to apply the reviewed SQL from `db/proposed/` as a migration (set *Execute backward incompatible database migrations* to *Ask each time* so the SQL is shown). Lovable writes the `drizzle/migrations/` file and regenerates `types.ts`; that commit syncs back to GitHub. Then delete the `db/proposed/` copy in a follow-up PR.
5. **Verify.** Run the backfill check query from the migration's test, and open a few goals.
6. **Rollback.** Prefer the `.down.sql` (column-level, keeps all other data) applied through the Lovable chat. Code from step 1 keeps working without the columns. Restoring a daily backup is the last resort: it reverts all data written since that backup.

## Current proposals

| File | Status | Notes |
| --- | --- | --- |
| `db/proposed/0005_goal_lifecycle.sql` (+ `.down.sql`) | Validated in CI; **awaiting staging + approval** | ADR-0001. Adds `goals.status`, `status_reason`, `status_changed_at`, check constraints and backfill. No policy changes. |
| `db/proposed/0006_billing.sql` (+ `.down.sql`) | Validated in CI; **awaiting staging + approval** | Billing tables, RLS, `apply_subscription_event()`. Independent of 0005; apply separately. See docs/BILLING.md. |
