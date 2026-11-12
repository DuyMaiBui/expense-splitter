import type { LedgerEntry } from "@/lib/types";

import { niceCeil } from "./chart-math";

/**
 * The arithmetic behind the member waterfall: where each bar starts and ends, the signed y-axis,
 * how wide each column is, and how the keyboard moves the selection.
 *
 * Pure and free of React, SVG and DOM types, so it is unit-tested in the `components/**` vitest
 * project without a renderer. The component only draws what these functions return.
 */

/** Drawing constants, in SVG user units (the plot is 1 unit = 1 CSS px, see WaterfallChart). */
export const WATERFALL_LAYOUT = {
  /** Headroom above the highest level, so an arrow marker never clips. */
  top: 12,
  /** Height of the plot area where levels are drawn. */
  plotHeight: 180,
  /** Space under the plot for the date labels. */
  labelHeight: 26,
  /** Left/right inset of the first and last column. */
  pad: 12,
  /** The plot is never narrower than this, so a short list still reads as a chart. */
  plotMinWidth: 280,
  /** A column is never narrower than this: a bar must stay tappable and legible. */
  slotMin: 26,
  /** A bar never grows wider than this, even when there are only a few entries. */
  barMax: 32,
  /** Gap kept between a bar and its column edge. */
  barInset: 6,
  /** Width of the fixed y-axis column on the left. */
  axisWidth: 48,
  /** Date labels are only drawn when there is room for this many px per label. */
  labelMinWidth: 34,
  /** A bar that moves zero (or almost zero) is still drawn at least this tall. */
  minBarPx: 3,
} as const;

export type FlowDirection = "up" | "down" | "flat";

export interface WaterfallStep {
  /** Index into the entries the chart was given (0-based, ledger order). */
  index: number;
  entry: LedgerEntry;
  /** Running level before this row: `runningNet - delta`. */
  from: number;
  /** Running level after this row: `entry.runningNet`. */
  to: number;
  /** `up` when delta > 0, `down` when delta < 0, `flat` when the row moves nothing. */
  direction: FlowDirection;
}

/** One bar per entry, from the level before it to the level after it. */
export function waterfallSteps(entries: readonly LedgerEntry[]): WaterfallStep[] {
  return entries.map((entry, index) => {
    const to = entry.runningNet;
    const from = entry.runningNet - entry.delta;
    const direction: FlowDirection = entry.delta > 0 ? "up" : entry.delta < 0 ? "down" : "flat";
    return { index, entry, from, to, direction };
  });
}

/**
 * The level the first bar starts from. For a current-cycle slice this is 0 ("huề" point); for the
 * full ledger it is also 0 because the ledger starts at 0. An empty list starts at 0.
 */
export function openingLevel(entries: readonly LedgerEntry[]): number {
  const first = entries[0];
  return first ? first.runningNet - first.delta : 0;
}

export interface WaterfallDomain {
  /** Lowest value on the axis (<= 0). */
  low: number;
  /** Highest value on the axis (>= 0). */
  high: number;
  /** Whole-VND distance between two ticks. */
  step: number;
  /** Ascending tick values, every multiple of `step` from `low` to `high`, including 0. */
  ticks: number[];
}

/**
 * The signed y-axis that contains every level, always including 0.
 *
 * The step is a "nice" whole number, so the ticks are integers and the domain's ends are exact
 * multiples of the step. Non-finite levels are ignored. A flat list (every level 0) still gets a
 * one-VND axis rather than a zero-height one.
 */
export function waterfallDomain(levels: readonly number[]): WaterfallDomain {
  let low = 0;
  let high = 0;
  for (const level of levels) {
    if (!Number.isFinite(level)) {
      continue;
    }
    low = Math.min(low, level);
    high = Math.max(high, level);
  }
  if (high === low) {
    high = low + 1;
  }

  const step = Math.max(1, Math.ceil(niceCeil((high - low) / 3)));
  const kLow = Math.floor(low / step);
  const kHigh = Math.ceil(high / step);
  const ticks: number[] = [];
  for (let k = kLow; k <= kHigh; k++) {
    ticks.push(k * step);
  }
  return { low: kLow * step, high: kHigh * step, step, ticks };
}

/**
 * The y coordinate of a level. The top of the plot is the highest level, the bottom the lowest,
 * so a larger level is always drawn higher (a smaller y).
 */
export function levelToY(
  level: number,
  domain: Pick<WaterfallDomain, "low" | "high">,
  top: number,
  height: number,
): number {
  const span = domain.high - domain.low;
  return top + ((domain.high - level) / span) * height;
}

export interface BarSpan {
  /** Top edge of the bar (the smaller y). */
  y: number;
  /** Bar height, at least `minPx`. */
  height: number;
}

/**
 * The vertical extent of one step's bar. The bar always spans between `from` and `to`, so its top
 * edge is the higher of the two levels. A zero move is widened to `minPx`, so it stays visible.
 */
export function barSpan(
  from: number,
  to: number,
  domain: Pick<WaterfallDomain, "low" | "high">,
  top: number,
  height: number,
  minPx: number,
): BarSpan {
  const yFrom = levelToY(from, domain, top, height);
  const yTo = levelToY(to, domain, top, height);
  return {
    y: Math.min(yFrom, yTo),
    height: Math.max(minPx, Math.abs(yTo - yFrom)),
  };
}

export interface ColumnLayout {
  /** Total width of the plot in SVG units (= CSS px). */
  svgWidth: number;
  /** Width of one column (one entry or the marker). */
  slot: number;
  /** Width of a drawn bar inside its column. */
  barWidth: number;
  /** Draw a date label every this many columns. */
  labelStep: number;
}

/**
 * How wide the plot must be for `columns` columns. The plot grows past the 280px minimum once the
 * columns would squeeze below `slotMin`, and the container scrolls horizontally instead of
 * shrinking the bars.
 */
export function columnLayout(columns: number): ColumnLayout {
  const L = WATERFALL_LAYOUT;
  const count = Math.max(1, columns);
  const svgWidth = Math.max(L.plotMinWidth, count * L.slotMin + 2 * L.pad);
  const slot = (svgWidth - 2 * L.pad) / count;
  const barWidth = Math.min(L.barMax, slot - L.barInset);
  const labelStep = Math.max(1, Math.ceil(L.labelMinWidth / slot));
  return { svgWidth, slot, barWidth, labelStep };
}

/** Left edge of column `index`. */
export function columnLeft(index: number, layout: ColumnLayout): number {
  return WATERFALL_LAYOUT.pad + index * layout.slot;
}

/** Horizontal centre of column `index`. */
export function columnCenter(index: number, layout: ColumnLayout): number {
  return columnLeft(index, layout) + layout.slot / 2;
}

/**
 * The selected column, clamped into range. `null` (nothing picked yet) and any out-of-range index
 * (a shorter list after a refetch) fall back to the last column, the "Số dư hiện tại" marker.
 */
export function clampSelection(selected: number | null, columns: number): number {
  const last = Math.max(0, columns - 1);
  if (selected === null || !Number.isInteger(selected) || selected < 0 || selected > last) {
    return last;
  }
  return selected;
}

/**
 * The new selection for a navigation key, or `null` when the key is not a navigation key.
 * Arrow keys step one column, Home/End jump to the first and the marker column.
 */
export function moveSelection(current: number, key: string, columns: number): number | null {
  const last = Math.max(0, columns - 1);
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, current - 1);
    case "ArrowRight":
      return Math.min(last, current + 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/**
 * Share of the largest value as a 0..100 width, for the member flow bars. A zero or negative
 * maximum gives 0 rather than NaN, and a value is never wider than the maximum.
 */
export function flowPercent(value: number, max: number): number {
  if (max <= 0 || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(100, (value / max) * 100);
}
