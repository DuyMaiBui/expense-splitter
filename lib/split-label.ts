import type { ExpenseShare } from "./types";

/**
 * How to label the "chia cho" line of an expense (docs/CONTRACT.md § SPLIT RULE).
 *
 * The split rule sorts the participants and gives the first (amount mod n) of them one extra
 * đồng, so a genuinely even split can differ by 1đ between people. Printing every amount after
 * every name then repeats the same figure N times and says nothing. A share counts as EQUAL
 * when the amounts are within 1đ of each other; only a real difference is worth printing.
 */

/** One participant's share, in the shape the API returns it. */
export interface SplitEntry {
  memberId: string;
  name: string;
  amount: number;
}

export interface SplitSummary {
  /** Every amount is within 1đ of every other; names alone carry the meaning. */
  equal: boolean;
  /** The participants are exactly the active members of the group, and there are at least 3. */
  everyone: boolean;
  /** Participant names, in the order the shares arrived. */
  names: string[];
  /** Every participant with their own amount, for the unequal case. */
  entries: SplitEntry[];
}

/**
 * Summarize an expense's shares for display.
 *
 * @param shares          the stored shares (one per participant)
 * @param nameOf          resolves a member id to a display name
 * @param activeMemberIds the group's active members; `everyone` stays false without it
 */
export function summarizeSplit(
  shares: readonly ExpenseShare[],
  nameOf: (id: string) => string,
  activeMemberIds?: readonly string[],
): SplitSummary {
  const entries: SplitEntry[] = shares.map((share) => ({
    memberId: share.memberId,
    name: nameOf(share.memberId),
    amount: share.amount,
  }));

  const amounts = entries.map((entry) => entry.amount);
  // Fewer than two participants cannot differ from each other.
  const equal = amounts.length < 2 || Math.max(...amounts) - Math.min(...amounts) <= 1;

  const participants = new Set(entries.map((entry) => entry.memberId));
  const everyone =
    activeMemberIds !== undefined &&
    activeMemberIds.length >= 3 &&
    participants.size === activeMemberIds.length &&
    activeMemberIds.every((id) => participants.has(id));

  return { equal, everyone, names: entries.map((entry) => entry.name), entries };
}
