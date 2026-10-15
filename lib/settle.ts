import type { Balance, Transfer } from "./types";

/**
 * Settlement: turn per-member paid/owed totals into the shortest-ish list of payments.
 * Pure functions so the arithmetic is unit-testable without a database.
 */

export interface MemberTotals {
  memberId: string;
  name: string;
  removed: boolean;
  paid: number;
  owed: number;
}

/** `net = paid - owed`: positive means the member is owed money. */
export function toBalances(totals: readonly MemberTotals[]): Balance[] {
  return totals.map((t) => ({
    memberId: t.memberId,
    name: t.name,
    removed: t.removed,
    paid: t.paid,
    owed: t.owed,
    net: t.paid - t.owed,
  }));
}

interface Side {
  memberId: string;
  remaining: number;
}

/**
 * Greedy matching: the largest debtor pays the largest creditor, until everyone is at zero.
 * Ties break on member id so the same input always gives the same output. At most
 * (members - 1) transfers. Balances must sum to 0 (they do when every share sums to its
 * expense amount); any residue is ignored rather than invented.
 */
export function computeTransfers(balances: readonly Balance[]): Transfer[] {
  const byLargest = (a: Side, b: Side) =>
    b.remaining - a.remaining || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);

  const creditors: Side[] = balances
    .filter((b) => b.net > 0)
    .map((b) => ({ memberId: b.memberId, remaining: b.net }))
    .sort(byLargest);
  const debtors: Side[] = balances
    .filter((b) => b.net < 0)
    .map((b) => ({ memberId: b.memberId, remaining: -b.net }))
    .sort(byLargest);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;

  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c]!;
    const debtor = debtors[d]!;
    const amount = Math.min(creditor.remaining, debtor.remaining);

    if (amount > 0) {
      transfers.push({ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amount });
    }

    creditor.remaining -= amount;
    debtor.remaining -= amount;
    if (creditor.remaining === 0) c += 1;
    if (debtor.remaining === 0) d += 1;
  }

  return transfers;
}
