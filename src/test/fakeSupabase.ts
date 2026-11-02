// In-memory stand-in for the subset of the Supabase query builder used by src/lib/goals.server.ts.
// It enforces primary keys (so "insert twice" fails like Postgres) and logs every operation so tests can
// assert write order. It does NOT model RLS, triggers or column defaults; real-database tests are spec R8.

type Row = Record<string, unknown>;
export type Op = "select" | "insert" | "update" | "delete" | "upsert";
type Filter = { col: string; kind: "eq" | "in" | "is"; value: unknown };
export interface LoggedOp {
  table: string;
  op: Op;
  filters: Filter[];
}
interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

const PRIMARY_KEYS: Record<string, string[]> = {
  goals: ["id"],
  goal_steps: ["goal_id", "step_key"],
  step_prereqs: ["goal_id", "step_key", "prereq_key"],
  proof_items: ["goal_id", "step_key", "item_key"],
  proof_submissions: ["goal_id", "step_key", "item_key"],
  messages: ["goal_id", "seq"],
  custom_plans: ["goal_id"],
  proof_overrides: ["goal_id", "step_key"],
};

export function fakeSupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const log: LoggedOp[] = [];
  const failures: { table: string; op: Op; message: string }[] = [];

  const rowsOf = (t: string) => (tables[t] ??= []);
  const keyOf = (t: string, r: Row) => {
    const pk = PRIMARY_KEYS[t];
    return pk ? JSON.stringify(pk.map((c) => r[c])) : null;
  };

  class Query implements PromiseLike<Result> {
    private op: Op = "select";
    private values: Row[] = [];
    private patch: Row = {};
    private filters: Filter[] = [];
    private sort: { col: string; asc: boolean } | null = null;
    private max: number | null = null;
    private one: "maybe" | "single" | null = null;
    private head = false;
    private returning = false;

    constructor(private table: string) {}

    select(_cols?: string, opts?: { head?: boolean; count?: string }) {
      if (this.op === "select") this.head = !!opts?.head;
      else this.returning = true;
      return this;
    }
    insert(v: Row | Row[]) {
      this.op = "insert";
      this.values = Array.isArray(v) ? v : [v];
      return this;
    }
    upsert(v: Row | Row[]) {
      this.op = "upsert";
      this.values = Array.isArray(v) ? v : [v];
      return this;
    }
    update(p: Row) {
      this.op = "update";
      this.patch = p;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(col: string, value: unknown) {
      this.filters.push({ col, kind: "eq", value });
      return this;
    }
    in(col: string, value: unknown[]) {
      this.filters.push({ col, kind: "in", value });
      return this;
    }
    is(col: string, value: null) {
      this.filters.push({ col, kind: "is", value });
      return this;
    }
    order(col: string, opts: { ascending?: boolean } = {}) {
      this.sort = { col, asc: opts.ascending !== false };
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
      return Promise.resolve()
        .then(() => this.run())
        .then(ok, fail);
    }

    private matches(r: Row) {
      return this.filters.every((f) =>
        f.kind === "eq"
          ? r[f.col] === f.value
          : f.kind === "in"
            ? (f.value as unknown[]).includes(r[f.col])
            : r[f.col] === null || r[f.col] === undefined,
      );
    }

    private shape(rows: Row[]): Result {
      const copy = structuredClone(rows);
      if (this.one === "maybe") return { data: copy[0] ?? null, error: null };
      if (this.one === "single")
        return copy[0]
          ? { data: copy[0], error: null }
          : { data: null, error: { message: "No rows", code: "PGRST116" } };
      return { data: copy, error: null };
    }

    private run(): Result {
      const t = this.table;
      log.push({ table: t, op: this.op, filters: [...this.filters] });
      const fi = failures.findIndex((f) => f.table === t && f.op === this.op);
      if (fi >= 0) {
        const [f] = failures.splice(fi, 1);
        return { data: null, error: { message: f!.message } };
      }
      const rows = rowsOf(t);

      if (this.op === "select") {
        let out = rows.filter((r) => this.matches(r));
        if (this.sort) {
          const { col, asc } = this.sort;
          out = [...out].sort(
            (a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1),
          );
        }
        if (this.max !== null) out = out.slice(0, this.max);
        if (this.head) return { data: null, error: null, count: out.length };
        return this.shape(out);
      }

      if (this.op === "insert" || this.op === "upsert") {
        const fresh = this.values.map((v) => {
          const r: Row = { ...v };
          if (PRIMARY_KEYS[t]?.[0] === "id" && r["id"] === undefined) r["id"] = crypto.randomUUID();
          return r;
        });
        const existing = new Map(rows.map((r, i) => [keyOf(t, r), i]));
        const batch = new Set<string | null>();
        for (const r of fresh) {
          const k = keyOf(t, r);
          if (k !== null && (batch.has(k) || (this.op === "insert" && existing.has(k))))
            return { data: null, error: { message: `duplicate key in ${t}`, code: "23505" } };
          batch.add(k);
        }
        for (const r of fresh) {
          const at = existing.get(keyOf(t, r));
          if (this.op === "upsert" && at !== undefined) rows[at] = { ...rows[at], ...r };
          else rows.push(r);
        }
        return this.returning ? this.shape(fresh) : { data: null, error: null };
      }

      if (this.op === "update") {
        const hit = rows.filter((r) => this.matches(r));
        for (const r of hit) Object.assign(r, this.patch);
        return this.returning ? this.shape(hit) : { data: null, error: null };
      }

      const keep = rows.filter((r) => !this.matches(r));
      const removed = rows.length - keep.length;
      tables[t] = keep;
      return { data: null, error: null, count: removed };
    }
  }

  return {
    client: { from: (table: string) => new Query(table) },
    tables,
    /** Current rows of a table (empty when it was never written). */
    rows: (table: string): Row[] => tables[table] ?? [],
    log,
    /** The next matching operation returns an error instead of running. */
    failNext(table: string, op: Op, message = "injected failure") {
      failures.push({ table, op, message });
    },
    writes: () => log.filter((l) => l.op !== "select"),
  };
}
