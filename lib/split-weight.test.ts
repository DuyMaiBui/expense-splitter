import { describe, expect, it } from "vitest";

import { splitEqual } from "./split";
import {
  adjustmentsOf,
  clampAdjust,
  formatAdjust,
  parseAdjustInput,
  splitWeighted,
} from "./split-weight";

const sum = (shares: { amount: number }[]) => shares.reduce((total, s) => total + s.amount, 0);
const amountsOf = (shares: { memberId: string; amount: number }[]) =>
  Object.fromEntries(shares.map((s) => [s.memberId, s.amount]));

describe("splitWeighted", () => {
  it("with no adjustment is exactly the equal split", () => {
    for (const [amount, ids] of [[120_000, ["b", "c", "d"]], [100, ["c", "a", "b"]], [7, ["x"]]] as const) {
      expect(splitWeighted(amount, ids).map(({ memberId, amount: a }) => ({ memberId, amount: a }))).toEqual(
        splitEqual(amount, ids),
      );
    }
  });

  it("B, C +10%, D normal: B and C each pay 1,1× what D pays", () => {
    const shares = splitWeighted(120_000, ["b", "c", "d"], new Map([["b", 10], ["c", 10]]));
    expect(amountsOf(shares)).toEqual({ b: 41_250, c: 41_250, d: 37_500 });
    expect(shares.map((s) => s.adjustPct)).toEqual([10, 10, 0]);
  });

  it("B +10% alone of three", () => {
    // weights 110 / 100 / 100 of 310: 42.580,65 / 38.709,68 / 38.709,68; the 2 spare đồng go to the larger fractions.
    const shares = splitWeighted(120_000, ["b", "c", "d"], new Map([["b", 10]]));
    expect(amountsOf(shares)).toEqual({ b: 42_580, c: 38_710, d: 38_710 });
    expect(sum(shares)).toBe(120_000);
  });

  it("supports negative adjustments down to −100% (pays nothing)", () => {
    expect(amountsOf(splitWeighted(90_000, ["a", "b"], new Map([["a", -50]])))).toEqual({ a: 30_000, b: 60_000 });
    expect(amountsOf(splitWeighted(90_000, ["a", "b"], new Map([["a", -100]])))).toEqual({ a: 0, b: 90_000 });
  });

  it("always sums to the amount", () => {
    const adjustments = new Map([["a", 7], ["b", -33], ["c", 250]]);
    for (const amount of [1, 7, 99_999, 1_000_000_000_000]) {
      expect(sum(splitWeighted(amount, ["a", "b", "c", "d"], adjustments))).toBe(amount);
    }
  });

  it("refuses out-of-range adjustments and a split where nobody pays", () => {
    expect(() => splitWeighted(100, ["a"], new Map([["a", 1001]]))).toThrow();
    expect(() => splitWeighted(100, ["a"], new Map([["a", 2.5]]))).toThrow();
    expect(() => splitWeighted(100, ["a", "b"], new Map([["a", -100], ["b", -100]]))).toThrow();
  });
});

describe("adjustmentsOf", () => {
  it("keeps only the non-zero adjustments", () => {
    const shares = splitWeighted(120_000, ["b", "c", "d"], new Map([["b", 10], ["c", 10]]));
    expect([...adjustmentsOf(shares)]).toEqual([["b", 10], ["c", 10]]);
    expect(adjustmentsOf(splitEqual(100, ["a", "b"])).size).toBe(0);
  });
});

describe("adjustment text", () => {
  it("formats with a sign and nothing for a normal share", () => {
    expect(formatAdjust(10)).toBe("+10%");
    expect(formatAdjust(-20)).toBe("−20%");
    expect(formatAdjust(0)).toBe("");
  });

  it("parses signed integers in range", () => {
    expect(parseAdjustInput("10")).toBe(10);
    expect(parseAdjustInput("+10%")).toBe(10);
    expect(parseAdjustInput("-20")).toBe(-20);
    expect(parseAdjustInput("−20")).toBe(-20);
    expect(parseAdjustInput("0")).toBe(0);
    expect(parseAdjustInput("+")).toBeNaN();
    expect(parseAdjustInput("")).toBeNaN();
    expect(parseAdjustInput("12,5")).toBeNaN();
    expect(parseAdjustInput("-101")).toBeNaN();
  });

  it("clamps steps into range", () => {
    expect(clampAdjust(-105)).toBe(-100);
    expect(clampAdjust(1005)).toBe(1000);
  });
});
