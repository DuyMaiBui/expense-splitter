import type { StatsBucket, StatsMember } from "@/lib/types";

/**
 * The arithmetic the two charts share: an axis with round ticks, a bar's pixel height, a donut's
 * slice offsets, and the member → slice merge.
 *
 * Everything here is pure and free of React, SVG and DOM types, so it can be unit-tested in the
 * `lib/**` vitest project without a renderer. The components are only the drawing.
 */

/** How many slices a donut draws before the rest collapse into "Khác". */
export const MAX_SLICES = 6;

/** The label of the merged slice. */
export const OTHER_LABEL = "Khác";

/**
 * Round y-axis ticks for a 3-4 line axis, ascending, starting at 0.
 *
 * The top tick is the amount rounded UP to a "nice" step (1, 2, 2.5 or 5 × a power of ten), so
 * every bar fits under it. A range of zero still yields [0, 1] so the axis has a height to draw.
 */
export function axisTicks(maxAmount: number, tickCount = 3): number[] {
  const top = niceCeil(Math.max(0, Math.round(maxAmount)));
  const step = top / Math.max(1, tickCount);
  return Array.from({ length: tickCount + 1 }, (_, index) => Math.round(step * index));
}

/** The smallest "nice" number at or above `value` (1, 2, 2.5 or 5 × 10^n). */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const candidate = factor * magnitude;
    if (candidate >= value) {
      return candidate;
    }
  }
  return 10 * magnitude;
}

/**
 * A bar's height in SVG units. A non-zero amount always draws at least `minVisible`, so a small
 * bucket is not a flat line under the baseline; a zero amount draws `stub` (a faint hairline).
 */
export function barHeight(
  amount: number,
  topTick: number,
  plotHeight: number,
  minVisible = 2,
  stub = 1,
): number {
  if (amount <= 0) {
    return stub;
  }
  const scaled = (amount / Math.max(1, topTick)) * plotHeight;
  return Math.min(plotHeight, Math.max(minVisible, scaled));
}

/** A share of a whole, 0..1; a zero or negative total is 0 rather than NaN. */
export function shareOf(amount: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, amount / total));
}

/** A 0..1 share as a whole-number percentage that never rounds a non-zero slice down to "0%". */
export function percentLabel(share: number, amount: number): number {
  const percent = Math.round(share * 100);
  if (percent === 0 && amount > 0) {
    return 1;
  }
  return Math.min(100, percent);
}

/** One drawing-ready donut slice. */
export interface Slice {
  key: string;
  label: string;
  amount: number;
  /** 0..1 of the whole. */
  share: number;
  /** Fraction of the ring where this slice starts (0..1, clockwise from 12 o'clock). */
  start: number;
  /** Fraction of the ring this slice covers (0..1). */
  length: number;
  removed: boolean;
  /** 1-based palette slot, so colour follows the member not its rank. */
  colorIndex: number;
  /** True for the merged "Khác" slice. */
  merged: boolean;
}

/** A member's spending row, whichever of owed/paid the toggle selected. */
interface MemberAmount {
  member: StatsMember;
  amount: number;
}

/**
 * Turns the API's member rows into at most `MAX_SLICES` drawing-ready slices.
 *
 * Sorted by amount descending (the biggest share first, so the donut reads clockwise from the
 * top). Ties keep the API's order, which is by name. A slice with no amount is dropped: a member
 * with activity in the range always has one, so an empty list means a genuinely empty donut.
 *
 * The merged "Khác" slice takes the next palette slot after the drawn members, so the colour of
 * a named slice never depends on how many small ones were folded away.
 */
export function buildSlices(members: readonly StatsMember[], mode: "owed" | "paid"): Slice[] {
  const rows: MemberAmount[] = members
    .map((member) => ({ member, amount: mode === "owed" ? member.owed : member.paid }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.member.name.localeCompare(b.member.name, "vi"));

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (total === 0) {
    return [];
  }

  // "At most MAX_SLICES" counts the merged slice: with a tail, only MAX_SLICES - 1 named slices
  // are drawn so the donut never exceeds the cap it advertises.
  const hasTail = rows.length > MAX_SLICES;
  const head = rows.slice(0, hasTail ? MAX_SLICES - 1 : MAX_SLICES);
  const tail = rows.slice(head.length);
  const slices: Slice[] = head.map((row) => ({
    key: row.member.memberId,
    label: row.member.name,
    amount: row.amount,
    share: shareOf(row.amount, total),
    start: 0,
    length: 0,
    removed: row.member.removed,
    colorIndex: 0,
    merged: false,
  }));

  if (tail.length > 0) {
    const amount = tail.reduce((sum, row) => sum + row.amount, 0);
    slices.push({
      key: "other",
      label: OTHER_LABEL,
      amount,
      share: shareOf(amount, total),
      start: 0,
      length: 0,
      removed: false,
      colorIndex: 0,
      merged: true,
    });
  }

  return offsetSlices(slices);
}

/**
 * Assigns each slice its palette slot and its arc offset.
 *
 * Slots are handed out by position after sorting, which is stable for a given member set: the
 * same member keeps the same colour while the toggle or a refetch does not reorder it. The arc
 * offsets accumulate the SHARES, so the slices always fill exactly one turn even when each
 * individual share was rounded.
 */
export function offsetSlices(slices: readonly Omit<Slice, "start" | "length">[]): Slice[] {
  let cursor = 0;
  return slices.map((slice, index) => {
    const length = slice.share;
    const drawn: Slice = { ...slice, colorIndex: index, start: cursor, length };
    cursor += length;
    return drawn;
  });
}

/** The most spending any bucket in the set holds (0 when there are no buckets). */
export function maxBucketAmount(buckets: readonly StatsBucket[]): number {
  return buckets.reduce((max, bucket) => Math.max(max, bucket.amount), 0);
}

/**
 * Which bucket labels a dense axis prints. A month of 28-31 day buckets would overlap its labels,
 * so only every 5th day is printed (1, 6, 11, …) plus the last day. Twelve months always fit.
 */
export function shouldLabelBucket(index: number, count: number): boolean {
  if (count <= 12) {
    return true;
  }
  return index === 0 || (index + 1) % 5 === 1 || index === count - 1;
}
