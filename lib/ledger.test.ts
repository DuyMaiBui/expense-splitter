import { describe, expect, it } from "vitest";

import {
  buildLedgerEntries,
  currentCycle,
  cycleSummary,
  ledgerTotals,
  type LedgerRow,
} from "./ledger";

const row = (over: Partial<LedgerRow> & { expenseId: string }): LedgerRow => ({
  kind: "expense",
  title: "t",
  spentAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  paidByMemberId: "m1",
  paidByName: "An",
  paid: 0,
  share: 0,
  counterpartyMemberId: null,
  counterpartyName: null,
  ...over,
});

/** Builds rows whose `delta` (paid - share) is exactly the given sequence, one per day. */
function rowsFromDeltas(deltas: number[]): LedgerRow[] {
  return deltas.map((d, i) =>
    row({
      expenseId: `e${i}`,
      spentAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      createdAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      paid: d > 0 ? d : 0,
      share: d < 0 ? -d : 0,
    }),
  );
}

describe("buildLedgerEntries: ordering", () => {
  it("orders by spentAt (the spend date), not by entry time", () => {
    // "dated-first" was entered last but spent first; it must still come first.
    const rows = [
      row({ expenseId: "dated-second", spentAt: "2026-02-01T00:00:00.000Z", createdAt: "2026-01-10T00:00:00.000Z" }),
      row({ expenseId: "dated-first", spentAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(buildLedgerEntries(rows).map((e) => e.expenseId)).toEqual(["dated-first", "dated-second"]);
  });

  it("slots a back-dated row entered later BEFORE an earlier-entered row it predates", () => {
    // Back-dated: spentAt is OLDER than the row entered before it, but createdAt is LATER.
    // Sorting by spentAt puts it first, the same as the expenses tab. A back-dated row can
    // therefore move a "huề" boundary, which is the accepted trade-off.
    const rows = [
      row({ expenseId: "entered-first", spentAt: "2026-02-01T00:00:00.000Z", createdAt: "2026-01-10T00:00:00.000Z" }),
      row({ expenseId: "back-dated", spentAt: "2026-01-05T00:00:00.000Z", createdAt: "2026-01-20T00:00:00.000Z" }),
    ];
    expect(buildLedgerEntries(rows).map((e) => e.expenseId)).toEqual(["back-dated", "entered-first"]);
  });

  it("breaks a spentAt tie on createdAt (entry time)", () => {
    const rows = [
      row({ expenseId: "entered-later", spentAt: "2026-01-05T00:00:00.000Z", createdAt: "2026-01-09T00:00:00.000Z" }),
      row({ expenseId: "entered-earlier", spentAt: "2026-01-05T00:00:00.000Z", createdAt: "2026-01-08T00:00:00.000Z" }),
    ];
    expect(buildLedgerEntries(rows).map((e) => e.expenseId)).toEqual(["entered-earlier", "entered-later"]);
  });

  it("breaks a spentAt and createdAt tie on expenseId", () => {
    const rows = [
      row({ expenseId: "tieB", spentAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-09T00:00:00.000Z" }),
      row({ expenseId: "tieA", spentAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-09T00:00:00.000Z" }),
    ];
    expect(buildLedgerEntries(rows).map((e) => e.expenseId)).toEqual(["tieA", "tieB"]);
  });

  it("breaks a full createdAt tie on expenseId", () => {
    const same = { spentAt: "2026-01-05T00:00:00.000Z", createdAt: "2026-01-05T00:00:00.000Z" };
    const rows = [row({ expenseId: "c", ...same }), row({ expenseId: "a", ...same }), row({ expenseId: "b", ...same })];
    expect(buildLedgerEntries(rows).map((e) => e.expenseId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ expenseId: "z", spentAt: "2026-03-01T00:00:00.000Z" }), row({ expenseId: "a" })];
    const snapshot = rows.map((r) => r.expenseId);
    buildLedgerEntries(rows);
    expect(rows.map((r) => r.expenseId)).toEqual(snapshot);
  });
});

describe("buildLedgerEntries: running net", () => {
  it("accumulates delta in order into runningNet", () => {
    const entries = buildLedgerEntries([
      row({ expenseId: "e1", spentAt: "2026-01-01T00:00:00.000Z", paid: 100, share: 40 }),
      row({ expenseId: "e2", spentAt: "2026-01-02T00:00:00.000Z", paid: 0, share: 30 }),
    ]);
    expect(entries.map((e) => e.delta)).toEqual([60, -30]);
    expect(entries.map((e) => e.runningNet)).toEqual([60, 30]);
  });

  it("sets settledAfter true exactly when runningNet returns to 0", () => {
    const entries = buildLedgerEntries(rowsFromDeltas([50, -20, -30, 10, -10]));
    expect(entries.map((e) => e.runningNet)).toEqual([50, 30, 0, 10, 0]);
    expect(entries.map((e) => e.settledAfter)).toEqual([false, false, true, false, true]);
  });

  it("gives a single entry for a payer who is also a participant", () => {
    const entries = buildLedgerEntries([row({ expenseId: "e1", paid: 100, share: 25 })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ paid: 100, share: 25, delta: 75, runningNet: 75, settledAfter: false });
  });

  it("keeps counterparty null for expense rows and fills it for payment rows", () => {
    const entries = buildLedgerEntries([
      row({ expenseId: "x", kind: "expense", counterpartyMemberId: "m9", counterpartyName: "Ghost" }),
      row({
        expenseId: "p",
        kind: "payment",
        spentAt: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-02T00:00:00.000Z",
        paid: 200,
        counterpartyMemberId: "m2",
        counterpartyName: "Bình",
      }),
    ]);
    expect(entries[0].counterpartyMemberId).toBeNull();
    expect(entries[0].counterpartyName).toBeNull();
    expect(entries[1].counterpartyMemberId).toBe("m2");
    expect(entries[1].counterpartyName).toBe("Bình");
  });

  it("gives a payment out a positive delta and a payment in a negative delta", () => {
    const entries = buildLedgerEntries([
      row({ expenseId: "out", kind: "payment", spentAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", paid: 200, share: 0, counterpartyMemberId: "m2", counterpartyName: "Bình" }),
      row({ expenseId: "in", kind: "payment", spentAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z", paid: 0, share: 200, counterpartyMemberId: "m2", counterpartyName: "Bình" }),
    ]);
    expect(entries.map((e) => e.delta)).toEqual([200, -200]);
    expect(entries.map((e) => e.settledAfter)).toEqual([false, true]);
  });

  it("returns an empty list for empty input", () => {
    expect(buildLedgerEntries([])).toEqual([]);
  });
});

describe("currentCycle", () => {
  it("has no zero point: the cycle is the whole ledger and not settled", () => {
    const entries = buildLedgerEntries(rowsFromDeltas([50, 20, -10]));
    expect(currentCycle(entries)).toEqual({ startIndex: 0, entries, settled: false });
  });

  it("starts after the single zero point in the middle of the list", () => {
    const entries = buildLedgerEntries(rowsFromDeltas([50, -50, 30]));
    const cycle = currentCycle(entries);
    expect(cycle.startIndex).toBe(2);
    expect(cycle.entries.map((e) => e.expenseId)).toEqual(["e2"]);
    expect(cycle.settled).toBe(false);
  });

  it("starts after the LAST zero point when there are several", () => {
    const entries = buildLedgerEntries(rowsFromDeltas([40, -40, 10, -10, 25]));
    const cycle = currentCycle(entries);
    expect(cycle.startIndex).toBe(4);
    expect(cycle.entries.map((e) => e.delta)).toEqual([25]);
  });

  it("is settled with an empty cycle when the zero point is the last entry", () => {
    const entries = buildLedgerEntries(rowsFromDeltas([50, -50]));
    expect(currentCycle(entries)).toEqual({ startIndex: 2, entries: [], settled: true });
  });

  it("returns the empty result for empty input", () => {
    expect(currentCycle([])).toEqual({ startIndex: 0, entries: [], settled: false });
  });
});

describe("cycleSummary", () => {
  it("sums count, paid, share and net over the given entries", () => {
    const entries = buildLedgerEntries(rowsFromDeltas([50, -50, 30, -10]));
    const cycle = currentCycle(entries);
    expect(cycleSummary(cycle.entries)).toEqual({ count: 2, totalPaid: 30, totalShare: 10, net: 20 });
  });

  it("is all zeros for empty input", () => {
    expect(cycleSummary([])).toEqual({ count: 0, totalPaid: 0, totalShare: 0, net: 0 });
  });
});

describe("ledgerTotals", () => {
  it("returns all zeros for empty input", () => {
    expect(ledgerTotals([])).toEqual({ spentPaid: 0, spentOwed: 0, paymentsOut: 0, paymentsIn: 0, net: 0 });
  });

  it("splits spending from settlement and keeps the Balance invariants", () => {
    const entries = buildLedgerEntries([
      row({ expenseId: "e1", spentAt: "2026-01-01T00:00:00.000Z", paid: 300, share: 100 }),
      row({ expenseId: "e2", spentAt: "2026-01-02T00:00:00.000Z", paid: 0, share: 30 }),
      row({ expenseId: "p1", kind: "payment", spentAt: "2026-01-03T00:00:00.000Z", paid: 100, share: 0, counterpartyMemberId: "m2", counterpartyName: "Bình" }),
      row({ expenseId: "p2", kind: "payment", spentAt: "2026-01-04T00:00:00.000Z", paid: 0, share: 100, counterpartyMemberId: "m2", counterpartyName: "Bình" }),
    ]);
    const totals = ledgerTotals(entries);

    expect(totals).toEqual({ spentPaid: 300, spentOwed: 130, paymentsOut: 100, paymentsIn: 100, net: 170 });
    // Last runningNet is the member's net position.
    expect(entries[entries.length - 1].runningNet).toBe(totals.net);
    // net = (spentPaid - spentOwed) + (paymentsOut - paymentsIn)
    expect(totals.net).toBe((totals.spentPaid - totals.spentOwed) + (totals.paymentsOut - totals.paymentsIn));
  });
});
