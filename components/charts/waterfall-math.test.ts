import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "@/lib/types";

import {
  WATERFALL_LAYOUT,
  barSpan,
  clampSelection,
  columnCenter,
  columnLayout,
  flowPercent,
  levelToY,
  moveSelection,
  openingLevel,
  waterfallDomain,
  waterfallSteps,
} from "./waterfall-math";

const L = WATERFALL_LAYOUT;

/** A ledger entry whose running net follows from `deltas` plus an optional opening level. */
function entriesFrom(deltas: number[], opening = 0): LedgerEntry[] {
  let running = opening;
  return deltas.map((delta, index) => {
    running += delta;
    return {
      expenseId: `e${index}`,
      kind: "expense",
      title: `Khoản ${index + 1}`,
      spentAt: "2026-11-01T03:00:00.000Z",
      paidByMemberId: "m1",
      paidByName: "An",
      paid: Math.max(0, delta),
      share: Math.max(0, -delta),
      delta,
      runningNet: running,
      settledAfter: running === 0,
      counterpartyMemberId: null,
      counterpartyName: null,
    };
  });
}

describe("waterfallSteps", () => {
  it("starts the first bar at 0 for a full ledger", () => {
    const steps = waterfallSteps(entriesFrom([100, -40]));

    expect(steps.map((step) => [step.from, step.to])).toEqual([
      [0, 100],
      [100, 60],
    ]);
  });

  it("starts the first bar at the opening level when the slice does not begin at 0", () => {
    // A cycle that begins at a running balance of 500: the first bar must rise from 500, not 0.
    const entries = entriesFrom([100, -30], 500);
    const steps = waterfallSteps(entries);

    expect(openingLevel(entries)).toBe(500);
    expect(steps[0]).toMatchObject({ from: 500, to: 600, direction: "up" });
    expect(steps[1]).toMatchObject({ from: 600, to: 570, direction: "down" });
  });

  it("keeps negative running balances: each bar starts where the previous one ended", () => {
    const entries = entriesFrom([-200, -50, 120]);
    const steps = waterfallSteps(entries);

    expect(steps.map((step) => step.to)).toEqual([-200, -250, -130]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].from).toBe(steps[i - 1].to);
    }
    expect(steps.map((step) => step.direction)).toEqual(["down", "down", "up"]);
  });

  it("crosses zero without losing the sign of either side", () => {
    // +100 then -250 takes the balance from above zero to below it, then +50 climbs back a little.
    const steps = waterfallSteps(entriesFrom([100, -250, 50]));

    expect(steps.map((step) => [step.from, step.to])).toEqual([
      [0, 100],
      [100, -150],
      [-150, -100],
    ]);
  });

  it("handles a single entry as one bar from 0 to its net", () => {
    const steps = waterfallSteps(entriesFrom([-75]));

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ index: 0, from: 0, to: -75, direction: "down" });
  });

  it("marks a row that moves nothing as flat", () => {
    const steps = waterfallSteps(entriesFrom([0, 40]));

    expect(steps[0].direction).toBe("flat");
    expect(steps[1].direction).toBe("up");
  });

  it("gives an empty list for no entries", () => {
    expect(waterfallSteps([])).toEqual([]);
    expect(openingLevel([])).toBe(0);
  });
});

describe("waterfallDomain", () => {
  it("contains 0 and every level, with negative ticks when the balance is negative", () => {
    const domain = waterfallDomain([0, -150, -100, 120]);

    expect(domain.ticks).toContain(0);
    expect(domain.ticks.some((tick) => tick < 0)).toBe(true);
    expect(domain.low).toBeLessThanOrEqual(-150);
    expect(domain.high).toBeGreaterThanOrEqual(120);
    expect(domain.ticks).toEqual([...domain.ticks].sort((a, b) => a - b));
  });

  it("keeps the ticks on whole multiples of one nice step", () => {
    const domain = waterfallDomain([0, 1_234_567]);

    expect(Number.isInteger(domain.step)).toBe(true);
    for (const tick of domain.ticks) {
      expect(tick % domain.step).toBe(0);
    }
  });

  it("gives a one-unit axis for a list that never moves", () => {
    const domain = waterfallDomain([0, 0]);

    expect(domain.high).toBeGreaterThan(domain.low);
    expect(domain.ticks).toContain(0);
  });

  it("ignores non-finite levels instead of producing NaN ticks", () => {
    const domain = waterfallDomain([0, Number.NaN, 90]);

    expect(domain.ticks.every(Number.isFinite)).toBe(true);
  });
});

describe("levelToY and barSpan (geometry)", () => {
  const domain = { low: -200, high: 200 };
  const top = 10;
  const height = 400;

  it("draws a higher level nearer the top of the plot", () => {
    expect(levelToY(200, domain, top, height)).toBe(top);
    expect(levelToY(-200, domain, top, height)).toBe(top + height);
    expect(levelToY(0, domain, top, height)).toBe(top + height / 2);
  });

  it("puts an up bar's top at the new level and its bottom at the previous one", () => {
    // Moving from -50 up to +50: the bar's top must be the +50 level, its bottom the -50 level.
    const span = barSpan(-50, 50, domain, top, height, L.minBarPx);

    expect(span.y).toBeCloseTo(levelToY(50, domain, top, height), 6);
    expect(span.y + span.height).toBeCloseTo(levelToY(-50, domain, top, height), 6);
  });

  it("puts a down bar's top at the previous level and its bottom at the new one", () => {
    // Moving from +50 down to -50: the bar's top must be the +50 level, its bottom the -50 level.
    const span = barSpan(50, -50, domain, top, height, L.minBarPx);

    expect(span.y).toBeCloseTo(levelToY(50, domain, top, height), 6);
    expect(span.y + span.height).toBeCloseTo(levelToY(-50, domain, top, height), 6);
  });

  it("widens a zero move to the minimum visible height", () => {
    const span = barSpan(80, 80, domain, top, height, L.minBarPx);

    expect(span.height).toBe(L.minBarPx);
  });

  it("keeps every bar inside the plot for a level range that includes 0", () => {
    const real = waterfallDomain([0, -150, 300]);
    for (const [from, to] of [
      [0, 300],
      [300, -150],
      [-150, 0],
    ]) {
      const span = barSpan(from, to, real, top, height, L.minBarPx);
      expect(span.y).toBeGreaterThanOrEqual(top - 1e-9);
      expect(span.y + span.height).toBeLessThanOrEqual(top + height + 1e-9);
    }
  });
});

describe("columnLayout", () => {
  it("keeps the 280px minimum for a short list", () => {
    const layout = columnLayout(3);

    expect(layout.svgWidth).toBe(L.plotMinWidth);
    expect(layout.barWidth).toBeLessThanOrEqual(L.barMax);
  });

  it("widens the plot instead of squeezing 60 entries below the bar minimum", () => {
    // 60 entries plus the marker column: the plot scrolls, every bar keeps at least 20px.
    const layout = columnLayout(61);

    expect(layout.svgWidth).toBeGreaterThan(L.plotMinWidth);
    expect(layout.slot).toBeGreaterThanOrEqual(L.slotMin);
    expect(layout.barWidth).toBeGreaterThanOrEqual(20);
  });

  it("places column centres inside the plot, left to right", () => {
    const layout = columnLayout(4);
    const centres = [0, 1, 2, 3].map((index) => columnCenter(index, layout));

    expect(centres).toEqual([...centres].sort((a, b) => a - b));
    expect(centres[0]).toBeGreaterThan(0);
    expect(centres[3]).toBeLessThan(layout.svgWidth);
  });

  it("labels every column when they are wide, every few when they are narrow", () => {
    expect(columnLayout(4).labelStep).toBe(1);
    expect(columnLayout(61).labelStep).toBeGreaterThan(1);
  });
});

describe("selection helpers", () => {
  it("falls back to the marker (last column) for no or an out-of-range selection", () => {
    expect(clampSelection(null, 5)).toBe(4);
    expect(clampSelection(9, 5)).toBe(4);
    expect(clampSelection(-1, 5)).toBe(4);
    expect(clampSelection(2, 5)).toBe(2);
  });

  it("steps with the arrow keys and jumps with Home and End, staying in range", () => {
    expect(moveSelection(0, "ArrowLeft", 5)).toBe(0);
    expect(moveSelection(2, "ArrowRight", 5)).toBe(3);
    expect(moveSelection(4, "ArrowRight", 5)).toBe(4);
    expect(moveSelection(3, "Home", 5)).toBe(0);
    expect(moveSelection(0, "End", 5)).toBe(4);
  });

  it("ignores keys that are not navigation", () => {
    expect(moveSelection(2, "a", 5)).toBeNull();
  });
});

describe("flowPercent", () => {
  it("scales a value against the largest of the four", () => {
    expect(flowPercent(50, 200)).toBe(25);
    expect(flowPercent(200, 200)).toBe(100);
  });

  it("returns 0 rather than NaN for a zero maximum or a zero value", () => {
    expect(flowPercent(0, 0)).toBe(0);
    expect(flowPercent(10, 0)).toBe(0);
    expect(flowPercent(0, 100)).toBe(0);
  });
});
