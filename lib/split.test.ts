import { describe, expect, it } from "vitest";

import { splitEqual } from "./split";

const sum = (shares: { amount: number }[]) => shares.reduce((total, s) => total + s.amount, 0);

describe("splitEqual", () => {
  it("splits evenly when the amount divides exactly", () => {
    expect(splitEqual(90_000, ["c", "a", "b"])).toEqual([
      { memberId: "a", amount: 30_000 },
      { memberId: "b", amount: 30_000 },
      { memberId: "c", amount: 30_000 },
    ]);
  });

  it("gives the remainder one đồng each to the first ids in ascending order", () => {
    expect(splitEqual(100, ["c", "b", "a"])).toEqual([
      { memberId: "a", amount: 34 },
      { memberId: "b", amount: 33 },
      { memberId: "c", amount: 33 },
    ]);
    expect(splitEqual(101, ["a", "b", "c"]).map((s) => s.amount)).toEqual([34, 34, 33]);
  });

  it("always sums to the amount", () => {
    for (const [amount, n] of [[1, 3], [7, 7], [1_000_003, 9], [999_999_999_999, 11]] as const) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      expect(sum(splitEqual(amount, ids))).toBe(amount);
    }
  });

  it("collapses duplicate ids and rejects an empty list", () => {
    expect(splitEqual(10, ["a", "a"])).toEqual([{ memberId: "a", amount: 10 }]);
    expect(() => splitEqual(10, [])).toThrow();
  });
});
