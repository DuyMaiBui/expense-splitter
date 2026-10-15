import { describe, expect, it } from "vitest";

import { computeTransfers, toBalances } from "./settle";

const totals = (rows: Array<[string, number, number]>) =>
  toBalances(
    rows.map(([memberId, paid, owed]) => ({ memberId, name: memberId, removed: false, paid, owed })),
  );

/** Applies transfers to the balances and returns what is still outstanding per member. */
function residual(balances: ReturnType<typeof totals>, transfers: ReturnType<typeof computeTransfers>) {
  const net = new Map(balances.map((b) => [b.memberId, b.net]));
  for (const t of transfers) {
    net.set(t.fromMemberId, (net.get(t.fromMemberId) ?? 0) + t.amount);
    net.set(t.toMemberId, (net.get(t.toMemberId) ?? 0) - t.amount);
  }
  return [...net.values()];
}

describe("toBalances", () => {
  it("net is paid minus owed", () => {
    expect(totals([["a", 100, 40]])[0]?.net).toBe(60);
  });
});

describe("computeTransfers", () => {
  it("returns nothing when everyone is even", () => {
    expect(computeTransfers(totals([["a", 50, 50], ["b", 20, 20]]))).toEqual([]);
  });

  it("one creditor, two debtors", () => {
    const balances = totals([["a", 90, 30], ["b", 0, 30], ["c", 0, 30]]);
    const transfers = computeTransfers(balances);
    expect(transfers).toEqual([
      { fromMemberId: "b", toMemberId: "a", amount: 30 },
      { fromMemberId: "c", toMemberId: "a", amount: 30 },
    ]);
  });

  it("settles everyone to zero with at most n-1 transfers", () => {
    const balances = totals([
      ["a", 300, 100],
      ["b", 0, 150],
      ["c", 100, 250],
      ["d", 250, 50],
      ["e", 0, 100],
    ]);
    const transfers = computeTransfers(balances);
    expect(transfers.length).toBeLessThanOrEqual(balances.length - 1);
    expect(residual(balances, transfers).every((n) => n === 0)).toBe(true);
    expect(transfers.every((t) => t.amount > 0)).toBe(true);
  });

  it("is deterministic regardless of input order", () => {
    const rows: Array<[string, number, number]> = [["x", 0, 40], ["y", 0, 40], ["z", 80, 0]];
    const forward = computeTransfers(totals(rows));
    const reversed = computeTransfers(totals([...rows].reverse()));
    expect(reversed).toEqual(forward);
  });
});
