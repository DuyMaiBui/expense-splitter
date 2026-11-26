import type { ExpenseShare } from "./types";

/**
 * How to label the "chia cho" line of an expense (docs/CONTRACT.md § SPLIT RULE).
 *
 * The split rule sorts the participants and gives the first (amount mod n) of them one extra
 * đồng, so a genuinely even split can differ by 1đ between people. Printing every amount after
 * every name then repeats the same figure N times and says nothing. A share counts as EQUAL
 * when the amounts are within 1đ of each other; only a real difference is worth printing.
 *
 * A split made with adjustments ("Bình, Chi +10%") is labelled by those adjustments, grouped,
 * rather than by raw amounts: the adjustment is what the person chose, the amount follows.
 */

/** One participant's share, in the shape the API returns it. */
export interface SplitEntry {
  memberId: string;
  name: string;
  amount: number;
}

/** Participants with the same adjustment (percent on top of a normal share). */
export interface SplitGroup {
  names: string[];
  /** 0 = normal share, +10 = pays 10% more than a normal share. */
  adjustPct: number;
  /** Each member's amount (the largest in the group; they differ by at most 1đ). */
  amount: number;
}

export interface SplitSummary {
  /** Every amount is within 1đ of every other; names alone carry the meaning. */
  equal: boolean;
  /** The participants are exactly the active members of the group, and there are at least 3. */
  everyone: boolean;
  /** Participant names, in the order the shares arrived. */
  names: string[];
  /** Every participant with their own amount, for an unequal split without adjustments. */
  entries: SplitEntry[];
  /** At least one participant has a non-zero adjustment. */
  adjusted: boolean;
  /**
   * The split grouped by adjustment, highest first ("Bình, Chi +10% · 41.250đ", then
   * "Dũng · 37.500đ"). Empty when nobody is adjusted.
   */
  groups: SplitGroup[];
}

function groupByAdjustment(shares: readonly ExpenseShare[], nameOf: (id: string) => string): SplitGroup[] {
  const byAdjust = new Map<number, SplitGroup>();
  for (const share of shares) {
    const adjustPct = share.adjustPct ?? 0;
    const group = byAdjust.get(adjustPct) ?? { names: [], adjustPct, amount: share.amount };
    group.names.push(nameOf(share.memberId));
    group.amount = Math.max(group.amount, share.amount);
    byAdjust.set(adjustPct, group);
  }
  return [...byAdjust.values()].sort((a, b) => b.adjustPct - a.adjustPct);
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

  const adjusted = shares.some((share) => (share.adjustPct ?? 0) !== 0);

  return {
    equal,
    everyone,
    names: entries.map((entry) => entry.name),
    entries,
    adjusted,
    groups: adjusted ? groupByAdjustment(shares, nameOf) : [],
  };
}
