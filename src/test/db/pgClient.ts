// Real-database test harness (spec R8). Runs the repository's actual migration files in a disposable
// in-process PostgreSQL (PGlite, WASM) and exposes a client that mimics the subset of the supabase-js
// query builder our server code uses. Each query runs in its own transaction as either
//   - `authenticated` with `request.jwt.claim.sub` set (RLS enforced, like the user's Supabase client), or
//   - `service_role` (BYPASSRLS, like supabaseAdmin).
// Never point this at a real project: it only ever talks to an in-memory database it created.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, unknown>;
type Result = {
  data: unknown;
  error: { message: string; code?: string | undefined } | null;
  count?: number | null;
};
type As = { role: "authenticated"; userId: string } | { role: "service_role" } | { role: "anon" };

const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "drizzle/migrations");

/** Migration tags in journal order (the order drizzle-kit applies them). */
export function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

export function migrationSql(tag: string): string {
  return readFileSync(path.join(MIGRATIONS, `${tag}.sql`), "utf8");
}

/** A fresh database with the Supabase stand-ins and every migration up to (and including) `upTo`. */
export async function freshDb(opts: { upTo?: string } = {}) {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(__dirname, "supabase-stubs.sql"), "utf8"));
  for (const tag of migrationTags()) {
    await db.exec(migrationSql(tag));
    if (tag === opts.upTo) break;
  }
  return db;
}

export type TestDb = Awaited<ReturnType<typeof freshDb>>;

/** Runs a proposed (not yet Lovable-applied) migration file from db/proposed/. */
export async function applyProposed(db: TestDb, file: string) {
  await db.exec(readFileSync(path.join(ROOT, "db/proposed", file), "utf8"));
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
};

/** Column types and primary keys, read from the catalog once per table. */
function catalog(db: TestDb) {
  const cache = new Map<string, Promise<{ types: Map<string, string>; pk: string[] }>>();
  return (table: string) => {
    let hit = cache.get(table);
    if (!hit) {
      hit = (async () => {
        const cols = await db.query<{ column_name: string; data_type: string }>(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        const pk = await db.query<{ attname: string }>(
          `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = ('public.' || $1)::regclass AND i.indisprimary`,
          [table],
        );
        return {
          types: new Map(cols.rows.map((c) => [c.column_name, c.data_type])),
          pk: pk.rows.map((r) => r.attname),
        };
      })();
      cache.set(table, hit);
    }
    return hit;
  };
}

/** Postgres values → the JSON shapes PostgREST returns (ISO timestamps, numeric as number). */
function toJson(row: Row, types: Map<string, string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (types.get(k) === "numeric" && typeof v === "string") out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

export function clientFor(
  db: TestDb,
  as: As,
  hooks: { failNext?: { table: string; op: string }[] | undefined } = {},
) {
  const meta = catalog(db);

  const run = (sql: string, params: unknown[]) =>
    db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE ${as.role}`);
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
        as.role === "authenticated" ? as.userId : "",
      ]);
      return tx.query<Row>(sql, params);
    });

  type Op = "select" | "insert" | "upsert" | "update" | "delete";

  class Query implements PromiseLike<Result> {
    private op: Op = "select";
    private cols = "*";
    private rows: Row[] = [];
    private patch: Row = {};
    private where: { sql: (p: () => string) => string; value?: unknown; hasValue: boolean }[] = [];
    private orderBy: string | null = null;
    private max: number | null = null;
    private one: "maybe" | "single" | null = null;
    private head = false;
    private count = false;
    private returning = false;

    constructor(private table: string) {}

    select(cols = "*", opts: { head?: boolean; count?: string } = {}) {
      if (this.op === "select") {
        this.cols = cols;
        this.head = !!opts.head;
        this.count = !!opts.count;
      } else {
        this.returning = true;
        this.cols = cols;
      }
      return this;
    }
    insert(v: Row | Row[]) {
      this.op = "insert";
      this.rows = Array.isArray(v) ? v : [v];
      return this;
    }
    upsert(v: Row | Row[]) {
      this.op = "upsert";
      this.rows = Array.isArray(v) ? v : [v];
      return this;
    }
    update(p: Row) {
      this.op = "update";
      this.patch = p;
      return this;
    }
    delete(opts: { count?: string } = {}) {
      this.op = "delete";
      this.count = !!opts.count;
      return this;
    }
    private filter(col: string, op: string, value: unknown) {
      this.where.push({ sql: (p) => `${ident(col)} ${op} ${p()}`, value, hasValue: true });
      return this;
    }
    eq(col: string, v: unknown) {
      return this.filter(col, "=", v);
    }
    gte(col: string, v: unknown) {
      return this.filter(col, ">=", v);
    }
    in(col: string, v: unknown[]) {
      this.where.push({ sql: (p) => `${ident(col)} = ANY(${p()})`, value: v, hasValue: true });
      return this;
    }
    is(col: string, _v: null) {
      this.where.push({ sql: () => `${ident(col)} IS NULL`, hasValue: false });
      return this;
    }
    not(col: string, op: "like", v: string) {
      if (op !== "like") throw new Error(`Unsupported not(${op})`);
      this.where.push({ sql: (p) => `NOT (${ident(col)} LIKE ${p()})`, value: v, hasValue: true });
      return this;
    }
    order(col: string, opts: { ascending?: boolean } = {}) {
      this.orderBy = `${ident(col)} ${opts.ascending === false ? "DESC" : "ASC"}`;
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    maybeSingle() {
      this.one = "maybe";
      return this;
    }
    single() {
      this.one = "single";
      return this;
    }
    then<A = Result, B = never>(
      ok?: ((r: Result) => A | PromiseLike<A>) | null,
      fail?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return this.exec().then(ok, fail);
    }

    private async exec(): Promise<Result> {
      const queued =
        hooks.failNext?.findIndex((f) => f.table === this.table && f.op === this.op) ?? -1;
      if (queued >= 0) {
        hooks.failNext!.splice(queued, 1);
        return { data: null, error: { message: "injected failure" } };
      }
      let types: Map<string, string>;
      let pk: string[];
      try {
        ({ types, pk } = await meta(this.table));
      } catch (e) {
        // Like PostgREST: a missing table is an error result, not a thrown exception.
        const err = e as { message?: string; code?: string };
        return { data: null, error: { message: err.message ?? String(e), code: err.code } };
      }
      const params: unknown[] = [];
      const p = (v?: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const val = (col: string, v: unknown) =>
        types.get(col) === "jsonb" && v !== null && v !== undefined ? JSON.stringify(v) : v;
      const whereSql = () =>
        this.where.length
          ? ` WHERE ${this.where.map((w) => w.sql(() => p(w.value))).join(" AND ")}`
          : "";
      const cols =
        this.cols === "*"
          ? "*"
          : this.cols
              .split(",")
              .map((c) => ident(c.trim()))
              .join(", ");
      const t = `public.${ident(this.table)}`;
      const ret = this.returning ? ` RETURNING ${cols}` : this.count ? " RETURNING 1" : "";

      let sql: string;
      if (this.op === "select") {
        sql = this.head
          ? `SELECT count(*)::int AS n FROM ${t}${whereSql()}`
          : `SELECT ${cols} FROM ${t}${whereSql()}${this.orderBy ? ` ORDER BY ${this.orderBy}` : ""}${
              this.max !== null ? ` LIMIT ${Number(this.max)}` : ""
            }`;
      } else if (this.op === "insert" || this.op === "upsert") {
        const all = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
        const values = this.rows
          .map((r) => `(${all.map((c) => (c in r ? p(val(c, r[c])) : "DEFAULT")).join(", ")})`)
          .join(", ");
        const conflict =
          this.op === "upsert"
            ? ` ON CONFLICT (${pk.map(ident).join(", ")}) DO UPDATE SET ${all
                .filter((c) => !pk.includes(c))
                .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`)
                .join(", ")}`
            : "";
        sql = `INSERT INTO ${t} (${all.map(ident).join(", ")}) VALUES ${values}${conflict}${ret}`;
      } else if (this.op === "update") {
        const set = Object.entries(this.patch)
          .map(([c, v]) => `${ident(c)} = ${p(val(c, v))}`)
          .join(", ");
        sql = `UPDATE ${t} SET ${set}${whereSql()}${ret}`;
      } else {
        sql = `DELETE FROM ${t}${whereSql()}${ret}`;
      }

      try {
        const res = await run(sql, params);
        if (this.op === "select" && this.head)
          return { data: null, error: null, count: Number(res.rows[0]?.["n"] ?? 0) };
        const rows = res.rows.map((r) => toJson(r, types));
        const count = this.count ? (res.affectedRows ?? rows.length) : null;
        if (this.op !== "select" && !this.returning) return { data: null, error: null, count };
        if (this.one === "maybe") return { data: rows[0] ?? null, error: null, count };
        if (this.one === "single")
          return rows[0]
            ? { data: rows[0], error: null, count }
            : { data: null, error: { message: "No rows", code: "PGRST116" }, count };
        return { data: rows, error: null, count };
      } catch (e) {
        const err = e as { message?: string; code?: string };
        return { data: null, error: { message: err.message ?? String(e), code: err.code } };
      }
    }
  }

  /** supabase-js `rpc(fn, namedArgs)` for scalar-returning functions. */
  const rpc = async (fn: string, args: Record<string, unknown> = {}): Promise<Result> => {
    const keys = Object.keys(args);
    const sql = `SELECT public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) AS result`;
    try {
      const res = await run(
        sql,
        keys.map((k) => args[k]),
      );
      return { data: res.rows[0]?.["result"] ?? null, error: null };
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return { data: null, error: { message: err.message ?? String(e), code: err.code } };
    }
  };

  return { from: (table: string) => new Query(table), rpc };
}

/** Runs raw SQL as a role, for storage-policy and privilege tests. Returns rows or the error. */
export async function sqlAs(db: TestDb, as: As, sql: string, params: unknown[] = []) {
  try {
    const res = await db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE ${as.role}`);
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
        as.role === "authenticated" ? as.userId : "",
      ]);
      return tx.query<Row>(sql, params);
    });
    return {
      rows: res.rows,
      affected: res.affectedRows ?? 0,
      error: null as null | { code?: string; message: string },
    };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { rows: [], affected: 0, error: { code: err.code, message: err.message ?? String(e) } };
  }
}
