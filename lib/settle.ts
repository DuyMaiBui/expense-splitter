import type { Balance } from "./types";

/**
 * Per-member settlement totals. Pure functions so the arithmetic is unit-testable without a database.
 * The payment list itself is `planTransfers` in lib/pairs.ts (direct debts first, then offsets).
 */

export interface MemberTotals {
  memberId: string;
  name: string;
  removed: boolean;
  paid: number;
  owed: number;
  /** Live `kind = "expense"` amounts this member paid. See `Balance` in types.ts. */
  spentPaid: number;
  /** Live `kind = "expense"` shares this member owes. */
  spentOwed: number;
  /** Live `kind = "payment"` amounts this member paid. */
  paymentsOut: number;
  /** Live `kind = "payment"` shares this member received. */
  paymentsIn: number;
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
    spentPaid: t.spentPaid,
    spentOwed: t.spentOwed,
    paymentsOut: t.paymentsOut,
    paymentsIn: t.paymentsIn,
  }));
}
