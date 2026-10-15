import { describe, expect, it } from "vitest";

import { MAX_PRESET_PRICE, MAX_QUANTITY, parsePresetBody, planSync, presetAmount } from "./presets";
import type { Preset } from "./types";

const preset = (id: string, name: string, unitPrice: number): Preset => ({
  id,
  groupId: "g",
  name,
  unitPrice,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("presetAmount", () => {
  it("multiplies unit price by quantity", () => {
    expect(presetAmount(29000, 1)).toBe(29000);
    expect(presetAmount(29000, 3)).toBe(87000);
    expect(presetAmount(29000, MAX_QUANTITY)).toBe(29000 * MAX_QUANTITY);
  });

  it("gives NaN for anything that is not a positive whole quantity in range", () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, MAX_QUANTITY + 1]) {
      expect(presetAmount(29000, quantity), String(quantity)).toBeNaN();
    }
  });

  it("gives NaN for an unusable unit price", () => {
    for (const unitPrice of [0, -1, 1.5, Number.NaN]) {
      expect(presetAmount(unitPrice, 2), String(unitPrice)).toBeNaN();
    }
  });
});

describe("planSync", () => {
  const source = [preset("s1", "Cầu lông", 29000), preset("s2", "Nước suối", 5000)];

  it("adds names the target lacks", () => {
    const plan = planSync(source, [], false);
    expect(plan.toAdd).toEqual([
      { name: "Cầu lông", unitPrice: 29000 },
      { name: "Nước suối", unitPrice: 5000 },
    ]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.skipped).toBe(0);
  });

  it("skips a name the target has, matching case-insensitively and by Vietnamese case", () => {
    const target = [preset("t1", "CẦU LÔNG", 31000)];
    const plan = planSync(source, target, false);
    expect(plan.toAdd.map((p) => p.name)).toEqual(["Nước suối"]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.skipped).toBe(1);
  });

  it("with overwrite only re-prices a differing match and keeps the target's name", () => {
    const target = [preset("t1", "cầu lông", 31000), preset("t2", "Nước suối", 5000)];
    const plan = planSync(source, target, true);
    expect(plan.toAdd).toEqual([]);
    expect(plan.toUpdate).toEqual([{ id: "t1", unitPrice: 29000 }]);
    expect(plan.skipped).toBe(1); // t2 already has the same price
  });

  it("collapses source names that differ only by case into one added row", () => {
    const plan = planSync([preset("s1", "Cầu", 1000), preset("s2", "CẦU", 2000)], [], false);
    expect(plan.toAdd).toEqual([{ name: "Cầu", unitPrice: 1000 }]);
    expect(plan.skipped).toBe(1);
  });

  it("does nothing for an empty source", () => {
    expect(planSync([], [preset("t1", "A", 1)], true)).toEqual({ toAdd: [], toUpdate: [], skipped: 0 });
  });
});

describe("parsePresetBody", () => {
  it("trims the name and accepts the price bounds", () => {
    expect(parsePresetBody({ name: "  Cầu lông ", unitPrice: 1 })).toEqual({ name: "Cầu lông", unitPrice: 1 });
    expect(parsePresetBody({ name: "x", unitPrice: MAX_PRESET_PRICE }).unitPrice).toBe(MAX_PRESET_PRICE);
  });

  it("rejects a non-object body and out-of-range values", () => {
    expect(() => parsePresetBody(null)).toThrow();
    expect(() => parsePresetBody({ name: "x", unitPrice: MAX_PRESET_PRICE + 1 })).toThrow();
    expect(() => parsePresetBody({ name: "x", unitPrice: 0 })).toThrow();
  });
});
