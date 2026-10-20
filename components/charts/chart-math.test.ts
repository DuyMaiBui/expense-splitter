import { describe, expect, it } from "vitest";

import type { StatsMember } from "@/lib/types";

import {
  MAX_SLICES,
  OTHER_LABEL,
  axisTicks,
  barHeight,
  buildSlices,
  maxBucketAmount,
  niceCeil,
  offsetSlices,
  percentLabel,
  shareOf,
  shouldLabelBucket,
} from "./chart-math";

function member(
  memberId: string,
  name: string,
  owed: number,
  paid: number,
  removed = false,
): StatsMember {
  return { memberId, name, removed, owed, paid };
}

describe("niceCeil", () => {
  it("rounds up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(230_000)).toBe(250_000);
    expect(niceCeil(1_200_000)).toBe(2_000_000);
  });

  it("keeps an already-nice value, and never returns zero", () => {
    expect(niceCeil(200)).toBe(200);
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-50)).toBe(1);
    expect(niceCeil(Number.NaN)).toBe(1);
  });
});

describe("axisTicks", () => {
  it("gives 0 plus three evenly spaced ticks with a nice top", () => {
    const ticks = axisTicks(230_000, 3);
    expect(ticks).toEqual([0, 83_333, 166_667, 250_000]);
  });

  it("still draws an axis for an all-zero range", () => {
    expect(axisTicks(0, 3)).toEqual([0, 0, 1, 1]);
  });
});

describe("barHeight", () => {
  it("scales an amount against the top tick", () => {
    expect(barHeight(50, 100, 110)).toBe(55);
  });

  it("keeps a tiny non-zero bucket visible and caps at the plot height", () => {
    expect(barHeight(1, 1_000_000, 110)).toBe(2);
    expect(barHeight(5_000_000, 1_000_000, 110)).toBe(110);
  });

  it("draws a faint stub for a zero bucket", () => {
    expect(barHeight(0, 100, 110)).toBe(1);
  });
});

describe("shareOf and percentLabel", () => {
  it("is a clamped fraction of the total", () => {
    expect(shareOf(25, 100)).toBe(0.25);
    expect(shareOf(25, 0)).toBe(0);
    expect(shareOf(-5, 100)).toBe(0);
  });

  it("never rounds a non-zero slice down to 0%", () => {
    expect(percentLabel(0.002, 1_000)).toBe(1);
    expect(percentLabel(0.002, 0)).toBe(0);
    expect(percentLabel(0.5, 10)).toBe(50);
  });
});

describe("buildSlices", () => {
  it("returns nothing for a zero total", () => {
    expect(buildSlices([member("a", "An", 0, 0)], "owed")).toEqual([]);
    expect(buildSlices([], "owed")).toEqual([]);
  });

  it("reads owed or paid according to the toggle", () => {
    const rows = [member("a", "An", 60, 10), member("b", "Bình", 40, 90)];
    expect(buildSlices(rows, "owed").map((s) => s.amount)).toEqual([60, 40]);
    expect(buildSlices(rows, "paid").map((s) => s.amount)).toEqual([90, 10]);
  });

  it("sorts by amount descending and offsets the arcs into one full turn", () => {
    const slices = buildSlices([member("a", "An", 30, 0), member("b", "Bình", 70, 0)], "owed");
    expect(slices.map((s) => s.label)).toEqual(["Bình", "An"]);
    expect(slices[0]).toMatchObject({ start: 0, length: 0.7 });
    expect(slices[1]).toMatchObject({ start: 0.7 });
    expect(slices[0]!.start + slices[0]!.length + slices[1]!.length).toBeCloseTo(1);
  });

  it("merges everything past the sixth slice into Khác", () => {
    const rows = Array.from({ length: 9 }, (_, index) =>
      member(`m${index}`, `Người ${index}`, 90 - index * 10, 0),
    );
    const slices = buildSlices(rows, "owed");
    expect(slices).toHaveLength(MAX_SLICES);
    const tail = slices[slices.length - 1]!;
    expect(tail).toMatchObject({ key: "other", label: OTHER_LABEL, merged: true });
    // Five named slices are drawn (90..50); the remaining four merge into Khác.
    expect(tail.amount).toBe(40 + 30 + 20 + 10);
    expect(slices.reduce((sum, slice) => sum + slice.amount, 0)).toBe(450);
  });

  it("keeps a removed member's slice and flags it", () => {
    const slices = buildSlices([member("a", "An", 10, 0, true)], "owed");
    expect(slices[0]).toMatchObject({ removed: true, length: 1 });
  });

  it("draws a single slice as the whole ring", () => {
    const slices = buildSlices([member("a", "An", 10, 0), member("b", "Bình", 0, 0)], "owed");
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ start: 0, length: 1, share: 1 });
  });
});

describe("offsetSlices", () => {
  it("starts each slice where the previous one ended", () => {
    const slices = offsetSlices([
      { key: "a", label: "A", amount: 1, share: 0.5, removed: false, colorIndex: 0, merged: false },
      { key: "b", label: "B", amount: 1, share: 0.5, removed: false, colorIndex: 0, merged: false },
    ]);
    expect(slices.map((s) => s.start)).toEqual([0, 0.5]);
  });
});

describe("partial buckets", () => {
  it("finds the tallest bucket, or 0 when there are none", () => {
    expect(maxBucketAmount([])).toBe(0);
    expect(
      maxBucketAmount([
        { key: "01", label: "T1", amount: 5, count: 1 },
        { key: "02", label: "T2", amount: 9, count: 1 },
      ]),
    ).toBe(9);
  });

  it("labels every bucket up to twelve and every fifth day beyond", () => {
    expect(shouldLabelBucket(11, 12)).toBe(true);
    const labelled = Array.from({ length: 31 }, (_, index) => index).filter((index) =>
      shouldLabelBucket(index, 31),
    );
    expect(labelled).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });
});
