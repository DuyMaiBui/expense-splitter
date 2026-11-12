import { describe, expect, it } from "vitest";

import {
  buildPairStatements,
  directDebts,
  parseRevision,
  planTransfers,
  type PairEventRow,
  type PairRevisionRow,
} from "./pairs";
import type { Balance, DirectDebt, PairRow, Transfer } from "./types";

/** A balance whose four split fields agree with `net` (spending only, no settlement payments). */
const bal = (memberId: string, net: number): Balance => ({
  memberId,
  name: memberId,
  removed: false,
  paid: Math.max(net, 0),
  owed: Math.max(-net, 0),
  net,
  spentPaid: Math.max(net, 0),
  spentOwed: Math.max(-net, 0),
  paymentsOut: 0,
  paymentsIn: 0,
});

const debt = (debtorId: string, creditorId: string, amount: number): DirectDebt => ({ debtorId, creditorId, amount });

/** Balances after applying every transfer: a debtor's net rises, a creditor's net falls. */
function afterTransfers(balances: readonly Balance[], transfers: readonly Transfer[]): Map<string, number> {
  const net = new Map(balances.map((b) => [b.memberId, b.net]));
  for (const t of transfers) {
    net.set(t.fromMemberId, (net.get(t.fromMemberId) ?? 0) + t.amount);
    net.set(t.toMemberId, (net.get(t.toMemberId) ?? 0) - t.amount);
  }
  return net;
}

const directTotal = (transfers: readonly Transfer[]) =>
  transfers.filter((t) => t.basis === "direct").reduce((sum, t) => sum + t.amount, 0);

/** Deterministic PRNG (LCG) so the property tests are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomInstance(rng: () => number): { balances: Balance[]; debts: DirectDebt[] } {
  const nDebtors = 1 + Math.floor(rng() * 2);
  const deficits = Array.from({ length: nDebtors }, () => 1 + Math.floor(rng() * 6));
  const total = deficits.reduce((a, b) => a + b, 0);
  const nCreditors = Math.min(1 + Math.floor(rng() * 3), total);
  const surpluses = Array.from({ length: nCreditors }, () => 1);
  for (let k = nCreditors; k < total; k++) surpluses[Math.floor(rng() * nCreditors)]! += 1;

  const balances = [
    ...deficits.map((d, i) => bal(`d${i}`, -d)),
    ...surpluses.map((s, j) => bal(`c${j}`, s)),
  ];
  const debts: DirectDebt[] = [];
  for (let i = 0; i < nDebtors; i++) {
    for (let j = 0; j < nCreditors; j++) {
      if (rng() < 0.6) debts.push(debt(`d${i}`, `c${j}`, 1 + Math.floor(rng() * 4)));
    }
  }
  return { balances, debts };
}

/** Exhaustive optimum of the direct step: every integer flow on the restricted edges, keep the best. */
function bruteForceMaxDirect(balances: readonly Balance[], debts: readonly DirectDebt[]): number {
  const remDeficit = new Map(balances.filter((b) => b.net < 0).map((b) => [b.memberId, -b.net]));
  const remSurplus = new Map(balances.filter((b) => b.net > 0).map((b) => [b.memberId, b.net]));
  const edges = debts.filter((d) => remDeficit.has(d.debtorId) && remSurplus.has(d.creditorId));

  let best = 0;
  const search = (i: number, total: number): void => {
    if (i === edges.length) {
      best = Math.max(best, total);
      return;
    }
    const e = edges[i]!;
    const cap = Math.min(e.amount, remDeficit.get(e.debtorId)!, remSurplus.get(e.creditorId)!);
    for (let f = 0; f <= cap; f++) {
      remDeficit.set(e.debtorId, remDeficit.get(e.debtorId)! - f);
      remSurplus.set(e.creditorId, remSurplus.get(e.creditorId)! - f);
      search(i + 1, total + f);
      remDeficit.set(e.debtorId, remDeficit.get(e.debtorId)! + f);
      remSurplus.set(e.creditorId, remSurplus.get(e.creditorId)! + f);
    }
  };
  search(0, 0);
  return best;
}

// ----------------------------------------------------------------------------- directDebts

describe("directDebts", () => {
  it("nets the reverse direction and keeps only the positive side", () => {
    // X owes Y 100 (Y paid, X had a share); Y owes X 30 back. Net: X owes Y 70.
    const rows: PairRow[] = [
      { payerId: "Y", debtorId: "X", amount: 100 },
      { payerId: "X", debtorId: "Y", amount: 30 },
    ];
    expect(directDebts(rows)).toEqual([debt("X", "Y", 70)]);
  });

  it("drops a pair whose two directions cancel exactly", () => {
    expect(
      directDebts([
        { payerId: "Y", debtorId: "X", amount: 50 },
        { payerId: "X", debtorId: "Y", amount: 50 },
      ]),
    ).toEqual([]);
  });

  it("sums repeated rows for one pair and sorts by debtor then creditor", () => {
    const rows: PairRow[] = [
      { payerId: "b", debtorId: "z", amount: 10 },
      { payerId: "a", debtorId: "z", amount: 5 },
      { payerId: "a", debtorId: "z", amount: 5 },
      { payerId: "a", debtorId: "y", amount: 7 },
    ];
    expect(directDebts(rows)).toEqual([debt("y", "a", 7), debt("z", "a", 10), debt("z", "b", 10)]);
  });

  it("refuses a row that makes someone owe their own payer", () => {
    expect(() => directDebts([{ payerId: "x", debtorId: "x", amount: 1 }])).toThrow();
  });
});

// ----------------------------------------------------------------------------- hand cases

describe("planTransfers: hand cases", () => {
  it("A owes only B while C is also a creditor: A pays B first, C gets only the leftover", () => {
    const balances = [bal("A", -100), bal("B", 60), bal("C", 40)];
    const transfers = planTransfers(balances, [debt("A", "B", 100)]);

    expect(transfers).toEqual([
      { fromMemberId: "A", toMemberId: "B", amount: 60, basis: "direct", directDebt: 100 },
      { fromMemberId: "A", toMemberId: "C", amount: 40, basis: "offset", directDebt: 0 },
    ]);
  });

  it("B does not pay A while B still has an open direct debt to C; the direct payments go first", () => {
    // B owes C 50 and nothing to A. D owes A 50 and nothing to C. A naive largest-with-largest pairing
    // would send B to A and D to C; the direct flow must send B to C and D to A instead.
    const balances = [bal("B", -50), bal("D", -50), bal("A", 50), bal("C", 50)];
    const transfers = planTransfers(balances, [debt("B", "C", 50), debt("D", "A", 50)]);

    expect(transfers).toHaveLength(2);
    expect(transfers).toContainEqual({ fromMemberId: "B", toMemberId: "C", amount: 50, basis: "direct", directDebt: 50 });
    expect(transfers).toContainEqual({ fromMemberId: "D", toMemberId: "A", amount: 50, basis: "direct", directDebt: 50 });
    expect(transfers.some((t) => t.fromMemberId === "B" && t.toMemberId === "A")).toBe(false);
  });

  it("offsets only what is left once direct payments are exhausted, with directDebt 0 for a pair with no debt", () => {
    // B owes C 30 directly, owes A nothing. C takes 30; the remaining 20 of B's deficit goes to A.
    const balances = [bal("B", -50), bal("A", 20), bal("C", 30)];
    const transfers = planTransfers(balances, [debt("B", "C", 30)]);

    expect(transfers).toEqual([
      { fromMemberId: "B", toMemberId: "C", amount: 30, basis: "direct", directDebt: 30 },
      { fromMemberId: "B", toMemberId: "A", amount: 20, basis: "offset", directDebt: 0 },
    ]);
  });

  it("gives [] for empty input and for a group that is already even", () => {
    expect(planTransfers([], [])).toEqual([]);
    expect(planTransfers([bal("A", 0), bal("B", 0)], [])).toEqual([]);
  });
});

// ----------------------------------------------------------------------------- real-group regression

/**
 * Real group ("cầu lông") at 2026-11-12, names replaced by letters:
 * A trunkk, B huongprowar, C mike, D hungdeptrai, E Dieu Anh, F Minh Anh, G mansinh,
 * H Khánh Hiền, I Raumania, J Huongquynh. Balances and direct debts are the fixture's own numbers.
 */
describe("regression: real group fixture", () => {
  const balances = [
    bal("A", 132710),
    bal("B", 4667),
    bal("C", 172814),
    bal("D", -95428),
    bal("E", -41000),
    bal("F", -53429),
    bal("G", 0),
    bal("H", 4666),
    bal("I", -41000),
    bal("J", -84000),
  ];
  const debts = [
    debt("E", "G", 8649),
    debt("E", "C", 47107),
    debt("E", "A", 118410),
    debt("J", "A", 84000),
    debt("H", "E", 35731),
    debt("H", "D", 65000),
    debt("H", "C", 48000),
    debt("F", "E", 26971),
    debt("F", "A", 144572),
    debt("I", "E", 10875),
    debt("I", "C", 50000),
    debt("D", "E", 1856),
    debt("D", "F", 88335),
    debt("D", "G", 6666),
    debt("D", "A", 108571),
    debt("B", "E", 57733),
    debt("B", "D", 45000),
    debt("B", "C", 135000),
    debt("G", "A", 48315),
    debt("C", "F", 29779),
    debt("C", "G", 33000),
    debt("C", "A", 44514),
    debt("A", "H", 153397),
    debt("A", "I", 19875),
    debt("A", "B", 242400),
  ];
  const transfers = planTransfers(balances, debts);

  it("the direct payments reach the true maximum of 214710 along direct edges", () => {
    expect(directTotal(transfers)).toBe(214710);
  });

  it("every balance is zero after all suggested transfers", () => {
    expect([...afterTransfers(balances, transfers).values()].every((n) => n === 0)).toBe(true);
  });

  // Owner's rule: J is paid cleanly to A (slack 0, so no offset); the offsets fall to D and F, the two
  // debtors with the largest slack (D 110000, F 118114).
  it("Huongquynh (J) is paid 84000 cleanly to A, with no offset", () => {
    expect(transfers.filter((t) => t.fromMemberId === "J")).toEqual([
      { fromMemberId: "J", toMemberId: "A", amount: 84000, basis: "direct", directDebt: 84000 },
    ]);
  });

  it("D and F carry the offsets, and the offsets total 100147", () => {
    const offsets = transfers.filter((t) => t.basis === "offset");
    expect(new Set(offsets.map((t) => t.fromMemberId))).toEqual(new Set(["D", "F"]));
    expect(offsets.reduce((sum, t) => sum + t.amount, 0)).toBe(100147);
  });

  it("the largest offset is 50074", () => {
    expect(Math.max(...transfers.filter((t) => t.basis === "offset").map((t) => t.amount))).toBe(50074);
  });

  it("every payment from J to someone other than A is a labelled offset", () => {
    const fromJ = transfers.filter((t) => t.fromMemberId === "J");
    expect(fromJ.filter((t) => t.toMemberId !== "A").every((t) => t.basis === "offset")).toBe(true);
    expect(fromJ.filter((t) => t.basis === "direct").every((t) => t.toMemberId === "A")).toBe(true);
  });

  it("no transfer goes from a creditor or to a debtor", () => {
    const net = new Map(balances.map((b) => [b.memberId, b.net]));
    for (const t of transfers) {
      expect(net.get(t.fromMemberId)!).toBeLessThan(0);
      expect(net.get(t.toMemberId)!).toBeGreaterThan(0);
    }
  });
});

// ----------------------------------------------------------------------------- property tests

describe("planTransfers: properties on random instances", () => {
  const rng = lcg(20261112);
  const instances = Array.from({ length: 300 }, () => randomInstance(rng));

  it("the direct total equals the brute-force maximum", () => {
    for (const { balances, debts } of instances) {
      const transfers = planTransfers(balances, debts);
      expect(directTotal(transfers)).toBe(bruteForceMaxDirect(balances, debts));
    }
  });

  it("applying every transfer brings every balance to exactly zero", () => {
    for (const { balances, debts } of instances) {
      const after = afterTransfers(balances, planTransfers(balances, debts));
      expect([...after.values()].every((n) => n === 0)).toBe(true);
    }
  });

  it("every direct transfer is within its direct debt, and each transfer is strictly positive", () => {
    for (const { balances, debts } of instances) {
      for (const t of planTransfers(balances, debts)) {
        expect(t.amount).toBeGreaterThan(0);
        if (t.basis === "direct") expect(t.amount).toBeLessThanOrEqual(t.directDebt);
      }
    }
  });

  it("an offset from D to C never happens while D still has an open direct debt to a creditor with surplus", () => {
    for (const { balances, debts } of instances) {
      const transfers = planTransfers(balances, debts);
      const surplusLeft = new Map(balances.filter((b) => b.net > 0).map((b) => [b.memberId, b.net]));
      for (const t of transfers.filter((x) => x.basis === "direct")) {
        surplusLeft.set(t.toMemberId, surplusLeft.get(t.toMemberId)! - t.amount);
      }
      for (const offset of transfers.filter((x) => x.basis === "offset")) {
        for (const d of debts.filter((x) => x.debtorId === offset.fromMemberId && x.creditorId !== offset.toMemberId)) {
          const paidDirect = transfers
            .filter((x) => x.basis === "direct" && x.fromMemberId === d.debtorId && x.toMemberId === d.creditorId)
            .reduce((sum, x) => sum + x.amount, 0);
          const open = surplusLeft.get(d.creditorId) ?? 0;
          expect(open === 0 || paidDirect === d.amount).toBe(true);
        }
      }
    }
  });

  it("is deterministic: the same balances and debts in any input order give the same transfers", () => {
    for (const { balances, debts } of instances) {
      const forward = planTransfers(balances, debts);
      const reversed = planTransfers([...balances].reverse(), [...debts].reverse());
      expect(reversed).toEqual(forward);
    }
  });
});

// ----------------------------------------------------------------------------- lexicographic rule

/** Greedy largest-with-largest over leftover amounts (ids do not change the amounts). */
function greedyOffsetAmounts(leftDeficit: number[], leftSurplus: number[]): number[] {
  const d = [...leftDeficit];
  const s = [...leftSurplus];
  const out: number[] = [];
  for (;;) {
    let i = -1;
    for (let k = 0; k < d.length; k++) if (d[k]! > 0 && (i < 0 || d[k]! > d[i]!)) i = k;
    let j = -1;
    for (let k = 0; k < s.length; k++) if (s[k]! > 0 && (j < 0 || s[k]! > s[j]!)) j = k;
    if (i < 0 || j < 0) return out;
    const amount = Math.min(d[i]!, s[j]!);
    out.push(amount);
    d[i]! -= amount;
    s[j]! -= amount;
  }
}

/** A debtor's slack: what it directly owes anyone, minus what it must pay. */
function slackOf(balances: readonly Balance[], debts: readonly DirectDebt[], memberId: string): number {
  const owed = debts.filter((d) => d.debtorId === memberId).reduce((sum, d) => sum + d.amount, 0);
  return owed + balances.find((b) => b.memberId === memberId)!.net;
}

/** Slacks of the given debtors, sorted descending. */
function slackVector(balances: readonly Balance[], debts: readonly DirectDebt[], ids: readonly string[]): number[] {
  return ids.map((id) => slackOf(balances, debts, id)).sort((a, b) => b - a);
}

/** Positive when `a` is the better vector: fewer entries are never compared, both have equal length. */
function compareSlacks(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return a[k]! - b[k]!;
  return a.length - b.length;
}

interface Objective {
  count: number;
  slacks: number[];
  maxOffset: number;
}

/**
 * The owner's objective, found exhaustively over every integer direct flow with the maximum total:
 * fewest debtors with an offset; then the offset debtors with the largest slacks (lexicographically);
 * then the smallest largest offset.
 */
function bruteLexicographic(balances: readonly Balance[], debts: readonly DirectDebt[]): Objective {
  const debtors = balances.filter((b) => b.net < 0).map((b) => b.memberId).sort();
  const creditors = balances.filter((b) => b.net > 0).map((b) => b.memberId).sort();
  const netOf = new Map(balances.map((b) => [b.memberId, b.net]));
  const remDeficit = debtors.map((id) => -netOf.get(id)!);
  const remSurplus = creditors.map((id) => netOf.get(id)!);
  const cells: Array<{ i: number; j: number; cap: number }> = [];
  debtors.forEach((d, i) =>
    creditors.forEach((c, j) => {
      const cap = debts.filter((x) => x.debtorId === d && x.creditorId === c).reduce((s, x) => s + x.amount, 0);
      if (cap > 0) cells.push({ i, j, cap });
    }),
  );
  const maxTotal = bruteForceMaxDirect(balances, debts);

  const found: Objective[] = [];
  const walk = (k: number, total: number): void => {
    if (k === cells.length) {
      if (total !== maxTotal) return;
      const offsetIds = debtors.filter((_, i) => remDeficit[i]! > 0);
      found.push({
        count: offsetIds.length,
        slacks: slackVector(balances, debts, offsetIds),
        maxOffset: Math.max(0, ...greedyOffsetAmounts(remDeficit, remSurplus)),
      });
      return;
    }
    const c = cells[k]!;
    const cap = Math.min(c.cap, remDeficit[c.i]!, remSurplus[c.j]!);
    for (let f = 0; f <= cap; f++) {
      remDeficit[c.i]! -= f;
      remSurplus[c.j]! -= f;
      walk(k + 1, total + f);
      remDeficit[c.i]! += f;
      remSurplus[c.j]! += f;
    }
  };
  walk(0, 0);

  const better = (x: Objective, y: Objective): boolean => {
    if (x.count !== y.count) return x.count < y.count;
    const bySlack = compareSlacks(x.slacks, y.slacks);
    if (bySlack !== 0) return bySlack > 0;
    return x.maxOffset < y.maxOffset;
  };
  return found.reduce((best, cur) => (better(cur, best) ? cur : best));
}

describe("planTransfers: lexicographic rule against exhaustive search", () => {
  const rng = lcg(777);
  const instances = Array.from({ length: 150 }, () => randomInstance(rng));

  it("the chosen offsets match the exhaustive optimum on (fewest offset debtors, largest slacks, largest offset)", () => {
    for (const { balances, debts } of instances) {
      const offsets = planTransfers(balances, debts).filter((t) => t.basis === "offset");
      const ids = [...new Set(offsets.map((t) => t.fromMemberId))];
      expect({
        count: ids.length,
        slacks: slackVector(balances, debts, ids),
        maxOffset: Math.max(0, ...offsets.map((t) => t.amount)),
      }).toEqual(bruteLexicographic(balances, debts));
    }
  });
});

// ----------------------------------------------------------------------------- statements

const ids = { me: "m", p: "p", q: "q" };
const members = {
  m: { name: "Mình", removed: false },
  p: { name: "Phúc", removed: false },
  q: { name: "Quỳnh", removed: true },
  r: { name: "Rạng", removed: false },
};

const T = {
  t1: "2026-01-01T00:00:00.000Z",
  t2: "2026-01-02T00:00:00.000Z",
  t2b: "2026-01-02T12:00:00.000Z",
  t3: "2026-01-03T00:00:00.000Z",
  t4: "2026-01-04T00:00:00.000Z",
  t5: "2026-01-05T00:00:00.000Z",
  t6: "2026-01-06T00:00:00.000Z",
};

/**
 * Live rows (current state) for member m:
 * X1 paid by m, 120 (m 60, p 60)          -> p owes m 60
 * X2 paid by p, 60 (m 30, p 30)           -> m owes p 30
 * Pay paid by m, 40 to p (p 40)           -> p owes m 40 (a payment cancels the other way)
 * X3 paid by m, 90 (m 30, q 60)           -> q owes m 60
 * X4 paid by q, 60 (m 20, q 40)           -> m owes q 20
 * The balance of m is computed from these rows in the test, not typed in.
 */
const liveRows: Array<{ expenseId: string; kind: "expense" | "payment"; title: string; createdAt: string; payer: string; shares: Record<string, number> }> = [
  { expenseId: "X1", kind: "expense", title: "Ăn trưa", createdAt: T.t1, payer: "m", shares: { m: 60, p: 60 } },
  { expenseId: "X2", kind: "expense", title: "Cà phê", createdAt: T.t2, payer: "p", shares: { m: 30, p: 30 } },
  { expenseId: "Pay", kind: "payment", title: "Trả", createdAt: T.t3, payer: "m", shares: { p: 40 } },
  { expenseId: "X3", kind: "expense", title: "Cầu", createdAt: "2026-01-03T06:00:00.000Z", payer: "m", shares: { m: 30, q: 60 } },
  { expenseId: "X4", kind: "expense", title: "Nước", createdAt: "2026-01-03T07:00:00.000Z", payer: "q", shares: { m: 20, q: 40 } },
];

function eventRowsFor(memberId: string): PairEventRow[] {
  const out: PairEventRow[] = [];
  for (const row of liveRows) {
    for (const [other, share] of Object.entries(row.shares)) {
      if (other === memberId) continue;
      const payerIsMe = row.payer === memberId;
      const payerIsOther = row.payer === other;
      if (!payerIsMe && !payerIsOther) continue;
      out.push({
        expenseId: row.expenseId,
        kind: row.kind,
        title: row.title,
        spentAt: row.createdAt,
        createdAt: row.createdAt,
        paidByMemberId: row.payer,
        counterpartyMemberId: other,
        memberShare: row.shares[memberId] ?? 0,
        counterpartyShare: share,
      });
    }
  }
  return out;
}

describe("buildPairStatements", () => {
  const revisions: PairRevisionRow[] = [
    {
      expenseId: "X2",
      title: "Cà phê",
      at: T.t2b,
      actorName: "Phúc",
      action: "update",
      before: { paidByMemberId: "p", amount: 50, shares: { m: 25, p: 25 } },
      after: { paidByMemberId: "p", amount: 60, shares: { m: 30, p: 30 } },
    },
    {
      // Edited after the payment: money had already moved between m and p.
      expenseId: "X1",
      title: "Ăn trưa",
      at: T.t4,
      actorName: "Mình",
      action: "update",
      before: { paidByMemberId: "m", amount: 100, shares: { m: 50, p: 50 } },
      after: { paidByMemberId: "m", amount: 120, shares: { m: 60, p: 60 } },
    },
    {
      // Paid by p and deleted after the payment: no live event of the pair any more.
      expenseId: "X5",
      title: "Taxi",
      at: T.t5,
      actorName: "Phúc",
      action: "delete",
      before: { paidByMemberId: "p", amount: 50, shares: { m: 25, p: 25 } },
      after: null,
    },
    {
      // Paid by m for r alone, then deleted: r has no live event at all, only this revision.
      expenseId: "X7",
      title: "Vé",
      at: T.t6,
      actorName: "Mình",
      action: "delete",
      before: { paidByMemberId: "m", amount: 40, shares: { m: 0, r: 40 } },
      after: null,
    },
  ];
  const statements = buildPairStatements(ids.me, eventRowsFor(ids.me), revisions, members);
  const byId = (id: string) => statements.find((s) => s.counterpartyMemberId === id)!;

  it("orders events by createdAt, computes delta and runningNet, and nets to the pairwise sum", () => {
    const p = byId("p");
    expect(p.events.map((e) => e.expenseId)).toEqual(["X1", "X2", "Pay"]);
    expect(p.events.map((e) => e.delta)).toEqual([60, -30, 40]);
    expect(p.events.map((e) => e.runningNet)).toEqual([60, 30, 70]);
    expect(p.net).toBe(70);
  });

  it("marks a revision after a payment as afterLaterPayment, and one before every payment as false", () => {
    const p = byId("p");
    const x1 = p.events.find((e) => e.expenseId === "X1")!;
    const x2 = p.events.find((e) => e.expenseId === "X2")!;
    expect(x1.revisions).toHaveLength(1);
    expect(x1.revisions[0]).toMatchObject({
      beforeAmount: 100,
      afterAmount: 120,
      beforeMemberShare: 50,
      afterMemberShare: 60,
      beforeCounterpartyShare: 50,
      afterCounterpartyShare: 60,
      afterLaterPayment: true,
    });
    expect(x2.revisions[0]!.afterLaterPayment).toBe(false);
  });

  it("a deleted expense that changed the pair after a payment shows in removedRevisions, flagged afterLaterPayment", () => {
    expect(byId("p").removedRevisions).toEqual([
      {
        expenseId: "X5",
        title: "Taxi",
        at: T.t5,
        actorName: "Phúc",
        action: "delete",
        beforeAmount: 50,
        afterAmount: null,
        beforeMemberShare: 25,
        afterMemberShare: null,
        beforeCounterpartyShare: 25,
        afterCounterpartyShare: null,
        afterLaterPayment: true,
      },
    ]);
  });

  it("a live, edited expense never appears in removedRevisions", () => {
    expect(byId("p").removedRevisions.some((r) => r.expenseId === "X1" || r.expenseId === "X2")).toBe(false);
  });

  it("a counterparty whose only trace is a removed revision still gets a statement, with net 0", () => {
    expect(byId("r")).toMatchObject({ counterpartyName: "Rạng", net: 0, events: [] });
    expect(byId("r").removedRevisions).toEqual([
      {
        expenseId: "X7",
        title: "Vé",
        at: T.t6,
        actorName: "Mình",
        action: "delete",
        beforeAmount: 40,
        afterAmount: null,
        beforeMemberShare: 0,
        afterMemberShare: null,
        beforeCounterpartyShare: 40,
        afterCounterpartyShare: null,
        afterLaterPayment: false,
      },
    ]);
  });

  it("per member, the statements net to that member's balance", () => {
    const balance = liveRows.reduce((sum, row) => {
      const mine = row.shares[ids.me] ?? 0;
      if (row.payer === ids.me) {
        const total = Object.values(row.shares).reduce((a, b) => a + b, 0);
        return sum + total - mine;
      }
      return sum - mine;
    }, 0);
    const statementTotal = statements.reduce((sum, s) => sum + s.net, 0);
    expect(statementTotal).toBe(balance);
    expect(balance).toBe(110);
  });

  it("sorts statements by |net| desc then name, and carries the removed flag", () => {
    expect(statements.map((s) => s.counterpartyMemberId)).toEqual(["p", "q", "r"]);
    expect(byId("q")).toMatchObject({ counterpartyName: "Quỳnh", removed: true, net: 40 });
  });

  it("refuses an event row that is not between the member and the counterparty", () => {
    const stray: PairEventRow = {
      expenseId: "Z",
      kind: "expense",
      title: "x",
      spentAt: T.t1,
      createdAt: T.t1,
      paidByMemberId: "q",
      counterpartyMemberId: "p",
      memberShare: 0,
      counterpartyShare: 1,
    };
    expect(() => buildPairStatements(ids.me, [stray], [], members)).toThrow();
  });
});

describe("parseRevision", () => {
  it("returns null for an action that is not an expense update or delete", () => {
    expect(
      parseRevision({ entityId: "X", actorName: "a", action: "expense.create", createdAt: T.t1, detailJson: "{}" }),
    ).toBeNull();
  });

  it("parses an update with before and after (title from before), and a delete with no after", () => {
    const expense = (
      title: string,
      paidByMemberId: string,
      amount: number,
      shares: Array<{ memberId: string; amount: number }>,
    ) => ({ title, paidByMemberId, amount, shares });
    const update = parseRevision({
      entityId: "X1",
      actorName: "Mình",
      action: "expense.update",
      createdAt: T.t4,
      detailJson: JSON.stringify({
        before: expense("Ăn trưa", "m", 100, [{ memberId: "m", amount: 50 }, { memberId: "p", amount: 50 }]),
        after: expense("Ăn trưa", "m", 120, [{ memberId: "m", amount: 60 }, { memberId: "p", amount: 60 }]),
      }),
    });
    expect(update).toEqual({
      expenseId: "X1",
      title: "Ăn trưa",
      at: T.t4,
      actorName: "Mình",
      action: "update",
      before: { paidByMemberId: "m", amount: 100, shares: { m: 50, p: 50 } },
      after: { paidByMemberId: "m", amount: 120, shares: { m: 60, p: 60 } },
    });

    const del = parseRevision({
      entityId: "X9",
      actorName: "Phúc",
      action: "expense.delete",
      createdAt: T.t3,
      detailJson: JSON.stringify({ before: expense("Taxi", "p", 40, [{ memberId: "p", amount: 40 }]) }),
    });
    expect(del).toMatchObject({
      title: "Taxi",
      action: "delete",
      after: null,
      before: { paidByMemberId: "p", amount: 40, shares: { p: 40 } },
    });
  });

  it("throws on a matching row whose detail is missing or not JSON", () => {
    expect(() =>
      parseRevision({ entityId: "X", actorName: "a", action: "expense.update", createdAt: T.t1, detailJson: null }),
    ).toThrow();
    expect(() =>
      parseRevision({ entityId: "X", actorName: "a", action: "expense.update", createdAt: T.t1, detailJson: "{oops" }),
    ).toThrow();
  });
});
