import type { ExpenseKind, LedgerEntry, LedgerTotals } from "./types";

/**
 * Per-member ledger: every live spend and receipt that involves one member, in order, with a
 * running net and the "huề" (settled) points. Pure functions, import-safe on the server and in
 * client components (type-only imports), so the arithmetic is unit-testable without a database.
 * Contract: docs/CONTRACT.md § ENDPOINTS (GET .../members/:memberId/ledger).
 */

/**
 * What the ledger SQL yields per row: one row per live expense the member paid or shared.
 * Unsorted input is allowed; `buildLedgerEntries` orders it.
 */
export interface LedgerRow {
  expenseId: string;
  kind: ExpenseKind;
  title: string;
  spentAt: string;
  createdAt: string;
  paidByMemberId: string;
  paidByName: string;
  /** Amount this member paid on the row (expense.amount when they are the payer, else 0). */
  paid: number;
  /** This member's expense_shares.amount on the row (0 if none). */
  share: number;
  /** kind "payment" only: the other party. Null for kind "expense". */
  counterpartyMemberId: string | null;
  counterpartyName: string | null;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Ledger order: spentAt asc (the date the spend happened), then createdAt asc, then expenseId asc.
 * This is the exact mirror of the expenses tab (`EXPENSE_ORDER` in lib/expenses.ts sorts
 * spent_at DESC, created_at DESC, id DESC), so the ledger and the list agree on which row came
 * first. Trade-off: a back-dated expense entered later can now sort before the member's last
 * "huề" and move the cycle boundary, the same as it already does in the expenses tab.
 */
function compareRows(a: LedgerRow, b: LedgerRow): number {
  return (
    compareText(a.spentAt, b.spentAt) ||
    compareText(a.createdAt, b.createdAt) ||
    compareText(a.expenseId, b.expenseId)
  );
}

/**
 * Sorts the rows into ledger order and computes `delta`, `runningNet` and `settledAfter` for each.
 * The input array is never mutated. Empty input gives an empty list.
 */
export function buildLedgerEntries(rows: readonly LedgerRow[]): LedgerEntry[] {
  const ordered = [...rows].sort(compareRows);
  let runningNet = 0;
  return ordered.map((row) => {
    const delta = row.paid - row.share;
    runningNet += delta;
    return {
      expenseId: row.expenseId,
      kind: row.kind,
      title: row.title,
      spentAt: row.spentAt,
      paidByMemberId: row.paidByMemberId,
      paidByName: row.paidByName,
      paid: row.paid,
      share: row.share,
      delta,
      runningNet,
      settledAfter: runningNet === 0,
      counterpartyMemberId: row.kind === "payment" ? row.counterpartyMemberId : null,
      counterpartyName: row.kind === "payment" ? row.counterpartyName : null,
    };
  });
}

/**
 * Totals with the same meaning as `Balance`: spending uses kind "expense" rows, settlement uses
 * kind "payment" rows. `net` is the sum of every `delta`, which equals
 * `(spentPaid - spentOwed) + (paymentsOut - paymentsIn)`.
 */
export function ledgerTotals(entries: readonly LedgerEntry[]): LedgerTotals {
  const totals: LedgerTotals = { spentPaid: 0, spentOwed: 0, paymentsOut: 0, paymentsIn: 0, net: 0 };
  for (const entry of entries) {
    totals.net += entry.delta;
    if (entry.kind === "payment") {
      totals.paymentsOut += entry.paid;
      totals.paymentsIn += entry.share;
    } else {
      totals.spentPaid += entry.paid;
      totals.spentOwed += entry.share;
    }
  }
  return totals;
}

export interface LedgerCycle {
  /** Index into the full ledger where the current cycle starts. */
  startIndex: number;
  /** Entries from `startIndex` to the end of the ledger. */
  entries: LedgerEntry[];
  /** True when the full ledger is non-empty and nothing has happened since the last "huề". */
  settled: boolean;
}

/**
 * The current cycle: everything after the LAST "huề" point (the last entry with `settledAfter`).
 * With no "huề" point, the cycle is the whole ledger. A "huề" on the final entry leaves an empty
 * cycle with `settled: true`.
 */
export function currentCycle(entries: readonly LedgerEntry[]): LedgerCycle {
  let lastSettled = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].settledAfter) {
      lastSettled = i;
      break;
    }
  }
  const startIndex = lastSettled + 1;
  const cycleEntries = entries.slice(startIndex);
  return {
    startIndex,
    entries: cycleEntries,
    settled: cycleEntries.length === 0 && entries.length > 0,
  };
}

export interface CycleSummary {
  count: number;
  totalPaid: number;
  totalShare: number;
  /** Sum of `delta` over the given entries. */
  net: number;
}

/** Count and sums over the given entries, typically the current cycle. */
export function cycleSummary(entries: readonly LedgerEntry[]): CycleSummary {
  const summary: CycleSummary = { count: entries.length, totalPaid: 0, totalShare: 0, net: 0 };
  for (const entry of entries) {
    summary.totalPaid += entry.paid;
    summary.totalShare += entry.share;
    summary.net += entry.delta;
  }
  return summary;
}
