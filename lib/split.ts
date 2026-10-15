import type { ExpenseShare } from "./types";

/**
 * Equal split of an integer amount (docs/CONTRACT.md § SPLIT RULE).
 *
 * Participants are sorted ascending; every share is floor(amount / n) and the first
 * (amount mod n) participants get one extra đồng, so the shares always sum to `amount`.
 * Duplicate ids are collapsed.
 */
export function splitEqual(amount: number, memberIds: readonly string[]): ExpenseShare[] {
  const ids = [...new Set(memberIds)].sort();
  if (ids.length === 0) {
    throw new Error("splitEqual needs at least one participant");
  }

  const base = Math.floor(amount / ids.length);
  const extra = amount % ids.length;

  return ids.map((memberId, index) => ({
    memberId,
    amount: base + (index < extra ? 1 : 0),
  }));
}
