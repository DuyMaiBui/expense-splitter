import { splitEqual } from "./split";
import type { ExpenseShare } from "./types";

/**
 * Weighted split (docs/CONTRACT.md § SPLIT RULE). Each participant has an ADJUSTMENT: the
 * percentage they pay on top of a normal share. 0 is normal (weight 1), +10 is weight 1,1,
 * -50 is weight 0,5, -100 pays nothing. The amount is shared in proportion to the weights, so
 * "B, C +10%, D normal" of 120.000đ is 41.250đ / 41.250đ / 37.500đ (B = C = D × 1,1).
 *
 * Import-safe on the server and in client components: the form previews with the SAME
 * function the API stores with.
 */

export const MIN_ADJUST = -100;
export const MAX_ADJUST = 1000;
/** One tap of − / + in the form moves an adjustment by this many percent. */
export const ADJUST_STEP = 5;

/**
 * Shares for `amount` with per-member adjustments (missing = 0). With no adjustment this is
 * exactly `splitEqual`. Otherwise each share is floor(amount × weight / Σweight) and the đồng
 * lost to rounding go one each to the largest fractional parts (ties by id ascending), so the
 * shares always sum to `amount`. Every share carries its `adjustPct`.
 *
 * @throws when there is no participant, an adjustment is out of range or not an integer, or
 *         every weight is zero (nobody would pay).
 */
export function splitWeighted(
  amount: number,
  memberIds: readonly string[],
  adjustments: ReadonlyMap<string, number> = new Map(),
): ExpenseShare[] {
  const ids = [...new Set(memberIds)].sort();
  const adjustOf = (id: string) => adjustments.get(id) ?? 0;
  for (const id of ids) {
    const adjust = adjustOf(id);
    if (!Number.isInteger(adjust) || adjust < MIN_ADJUST || adjust > MAX_ADJUST) {
      throw new Error(`splitWeighted: adjustment ${adjust} is out of range`);
    }
  }

  if (ids.every((id) => adjustOf(id) === 0)) {
    return splitEqual(amount, ids).map((share) => ({ ...share, adjustPct: 0 }));
  }

  const weights = ids.map((id) => 100 + adjustOf(id));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) {
    throw new Error("splitWeighted: every weight is zero");
  }

  // Integer arithmetic: amount ≤ 1e12 and weight ≤ 1100 stay far below 2^53.
  const raw = ids.map((memberId, index) => {
    const numerator = amount * weights[index]!;
    return {
      memberId,
      amount: Math.floor(numerator / totalWeight),
      remainder: numerator % totalWeight,
      adjustPct: adjustOf(memberId),
    };
  });

  let left = amount - raw.reduce((sum, share) => sum + share.amount, 0);
  const byRemainder = [...raw].sort((a, b) => b.remainder - a.remainder || a.memberId.localeCompare(b.memberId));
  for (const share of byRemainder) {
    if (left <= 0) {
      break;
    }
    share.amount += 1;
    left -= 1;
  }

  return raw.map(({ memberId, amount: value, adjustPct }) => ({ memberId, amount: value, adjustPct }));
}

/** The non-zero adjustments of stored shares, to reopen an expense in the form. */
export function adjustmentsOf(shares: readonly ExpenseShare[]): Map<string, number> {
  return new Map(
    shares.filter((share) => (share.adjustPct ?? 0) !== 0).map((share) => [share.memberId, share.adjustPct!]),
  );
}

/** "+10%", "−20%", or "" for a normal share. */
export function formatAdjust(adjust: number): string {
  if (adjust === 0) {
    return "";
  }
  return `${adjust > 0 ? "+" : "−"}${Math.abs(adjust)}%`;
}

/** Parses "10", "+10", "-20", "−20" or "10%" into an integer adjustment; NaN when invalid or out of range. */
export function parseAdjustInput(text: string): number {
  const normalized = text.trim().replace("−", "-").replace(/%$/, "").trim();
  if (normalized === "" || normalized === "+" || normalized === "-") {
    return Number.NaN;
  }
  if (!/^[+-]?\d+$/.test(normalized)) {
    return Number.NaN;
  }
  const value = Number(normalized);
  return value >= MIN_ADJUST && value <= MAX_ADJUST ? value : Number.NaN;
}

/** Clamps a stepped value into the allowed range. */
export function clampAdjust(adjust: number): number {
  return Math.min(Math.max(Math.round(adjust), MIN_ADJUST), MAX_ADJUST);
}
