import { describe, expect, it } from "vitest";

import { computeTransfers, toBalances, type MemberTotals } from "./settle";

/** Spending-only totals: every amount is an expense, no settlement payments. */
const totals = (rows: Array<[string, number, number]>) =>
  toBalances(
    rows.map(([memberId, paid, owed]) => ({
      memberId,
      name: memberId,
      removed: false,
      paid,
      owed,
      spentPaid: paid,
      spentOwed: owed,
      paymentsOut: 0,
      paymentsIn: 0,
    })),
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

/** A live row as the database holds it: one payer, shares keyed by member id. */
interface Row {
  kind: "expense" | "payment";
  paidBy: string;
  amount: number;
  shares: Record<string, number>;
}

/**
 * Independent oracle for the route's SQL: `paid` and `owed` are computed the original way (every
 * row, regardless of kind), and the four split fields are computed per kind. The invariants below
 * then check the split against the whole-row totals, so a wrong kind filter cannot pass.
 */
function fromRows(rows: readonly Row[], memberIds: readonly string[]): MemberTotals[] {
  return memberIds.map((memberId) => {
    let paid = 0;
    let owed = 0;
    let spentPaid = 0;
    let spentOwed = 0;
    let paymentsOut = 0;
    let paymentsIn = 0;
    for (const row of rows) {
      if (row.paidBy === memberId) {
        paid += row.amount;
        if (row.kind === "expense") spentPaid += row.amount;
        else paymentsOut += row.amount;
      }
      const share = row.shares[memberId] ?? 0;
      if (share !== 0) {
        owed += share;
        if (row.kind === "expense") spentOwed += share;
        else paymentsIn += share;
      }
    }
    return {
      memberId,
      name: memberId,
      removed: false,
      paid,
      owed,
      spentPaid,
      spentOwed,
      paymentsOut,
      paymentsIn,
    };
  });
}

/** Three members: a and b share costs, b pays a 50, c pays b 20 back. */
const scenario: Row[] = [
  { kind: "expense", paidBy: "a", amount: 300, shares: { a: 100, b: 100, c: 100 } },
  { kind: "expense", paidBy: "b", amount: 90, shares: { a: 45, b: 45 } },
  { kind: "payment", paidBy: "b", amount: 50, shares: { a: 50 } },
  { kind: "payment", paidBy: "c", amount: 20, shares: { b: 20 } },
];

describe("toBalances", () => {
  it("net is paid minus owed", () => {
    expect(totals([["a", 100, 40]])[0]?.net).toBe(60);
  });

  it("passes the four split fields through unchanged", () => {
    const [balance] = toBalances([
      {
        memberId: "m",
        name: "m",
        removed: false,
        paid: 140,
        owed: 165,
        spentPaid: 90,
        spentOwed: 145,
        paymentsOut: 50,
        paymentsIn: 20,
      },
    ]);
    expect(balance).toMatchObject({ spentPaid: 90, spentOwed: 145, paymentsOut: 50, paymentsIn: 20 });
    expect(balance?.net).toBe(-25);
  });
});

describe("per-member split of paid and owed", () => {
  const balances = toBalances(fromRows(scenario, ["a", "b", "c"]));
  const byId = (id: string) => balances.find((b) => b.memberId === id)!;

  it("gives the expected numbers for each member", () => {
    expect(byId("a")).toMatchObject({ paid: 300, owed: 195, net: 105, spentPaid: 300, spentOwed: 145, paymentsOut: 0, paymentsIn: 50 });
    expect(byId("b")).toMatchObject({ paid: 140, owed: 165, net: -25, spentPaid: 90, spentOwed: 145, paymentsOut: 50, paymentsIn: 20 });
    expect(byId("c")).toMatchObject({ paid: 20, owed: 100, net: -80, spentPaid: 0, spentOwed: 100, paymentsOut: 20, paymentsIn: 0 });
  });

  it("paid = spentPaid + paymentsOut and owed = spentOwed + paymentsIn for every member", () => {
    for (const b of balances) {
      expect(b.paid).toBe(b.spentPaid + b.paymentsOut);
      expect(b.owed).toBe(b.spentOwed + b.paymentsIn);
    }
  });

  it("net = (spentPaid - spentOwed) + (paymentsOut - paymentsIn) for every member", () => {
    for (const b of balances) {
      expect(b.net).toBe(b.spentPaid - b.spentOwed + (b.paymentsOut - b.paymentsIn));
      expect(b.net).toBe(b.paid - b.owed);
    }
  });

  it("group-wide, spending matches totalSpent on both sides and payments cancel out", () => {
    const totalSpent = scenario.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0);
    const sum = (pick: (b: (typeof balances)[number]) => number) => balances.reduce((s, b) => s + pick(b), 0);

    expect(totalSpent).toBe(390);
    expect(sum((b) => b.spentPaid)).toBe(totalSpent);
    expect(sum((b) => b.spentOwed)).toBe(totalSpent);
    expect(sum((b) => b.paymentsOut)).toBe(sum((b) => b.paymentsIn));
    expect(sum((b) => b.net)).toBe(0);
  });

  it("a member with no rows gets all four split fields at 0", () => {
    const [idle] = toBalances(fromRows(scenario, ["nobody"]));
    expect(idle).toMatchObject({ paid: 0, owed: 0, net: 0, spentPaid: 0, spentOwed: 0, paymentsOut: 0, paymentsIn: 0 });
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
