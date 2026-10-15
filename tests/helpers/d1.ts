import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * A just-enough D1 stand-in on top of node:sqlite, so route handlers run their real SQL
 * (real constraints, real foreign keys, real unique indexes) in tests.
 *
 * Mirrors the D1 surface the app uses: prepare().bind().first()/all()/run() and batch().
 * `batch` is transactional like D1's: all statements apply, or none do.
 */
class Statement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly args: SQLInputValue[] = [],
  ) {}

  bind(...args: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, args as SQLInputValue[]);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.args);
    return row ? ({ ...row } as T) : null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const rows = this.sqlite.prepare(this.sql).all(...this.args);
    return { results: rows.map((row) => ({ ...row }) as T), success: true };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const info = this.sqlite.prepare(this.sql).run(...this.args);
    return {
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

export interface TestDb {
  /** Pass this where the app expects a `D1Database`. */
  d1: D1Database;
  /** Direct handle for assertions the API does not expose (row counts, soft-delete flags). */
  raw: DatabaseSync;
}

export function createTestDb(migrationSql: string): TestDb {
  const raw = new DatabaseSync(":memory:");
  raw.exec(migrationSql);

  const d1 = {
    prepare: (sql: string) => new Statement(raw, sql),
    async batch(statements: Statement[]) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };

  return { d1: d1 as unknown as D1Database, raw };
}
