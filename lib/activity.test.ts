import { describe, expect, it } from "vitest";

import { logStatement } from "./activity";

/** Records what would be sent to D1 without executing anything. */
function fakeDb() {
  const prepared: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const statement = { sql, args };
          prepared.push(statement);
          return statement;
        },
      };
    },
  };
  return { db: db as unknown as D1Database, prepared };
}

const base = {
  groupId: "g1",
  actorUserId: "u1",
  actorName: "Alice",
  action: "expense.create" as const,
  entityType: "expense" as const,
  entityId: "e1",
  summary: 'Alice đã thêm chi tiêu "Ăn tối" 100.000đ',
};

describe("logStatement", () => {
  it("returns an INSERT into activity_log binding every column in order", () => {
    const { db, prepared } = fakeDb();
    logStatement(db, { ...base, detail: { after: { id: "e1" } } });

    expect(prepared).toHaveLength(1);
    const { sql, args } = prepared[0]!;
    expect(sql).toMatch(/INSERT INTO activity_log/);
    expect(args.slice(0, 7)).toEqual([
      "g1",
      "u1",
      "Alice",
      "expense.create",
      "expense",
      "e1",
      base.summary,
    ]);
    expect(args[7]).toBe('{"after":{"id":"e1"}}');
    expect(args[8]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it("stores NULL when there is no detail", () => {
    const { db, prepared } = fakeDb();
    logStatement(db, base);
    logStatement(db, { ...base, detail: null });
    expect(prepared[0]!.args[7]).toBeNull();
    expect(prepared[1]!.args[7]).toBeNull();
  });
});
