import { describe, expect, it } from "vitest";

import { splitEqual } from "./split";
import { summarizeSplit } from "./split-label";

const NAMES: Record<string, string> = { a: "Lan", b: "Hưng", c: "Mai", d: "Tuấn" };
const nameOf = (id: string) => NAMES[id] ?? "?";

describe("summarizeSplit", () => {
  it("reports an equal split so the label can list names only", () => {
    const summary = summarizeSplit(
      [
        { memberId: "a", amount: 40_000 },
        { memberId: "b", amount: 40_000 },
      ],
      nameOf,
    );

    expect(summary.equal).toBe(true);
    expect(summary.names).toEqual(["Lan", "Hưng"]);
    expect(summary.everyone).toBe(false);
  });

  it("treats the split rule's 1đ rounding as equal", () => {
    // 100 / 3 = 34, 33, 33: the first participant gets the extra đồng.
    const summary = summarizeSplit(splitEqual(100, ["a", "b", "c"]), nameOf);

    expect(summary.entries.map((entry) => entry.amount)).toEqual([34, 33, 33]);
    expect(summary.equal).toBe(true);
    expect(summary.names).toEqual(["Lan", "Hưng", "Mai"]);
  });

  it("keeps each amount when the shares differ by more than 1đ", () => {
    const summary = summarizeSplit(
      [
        { memberId: "a", amount: 50_000 },
        { memberId: "b", amount: 70_000 },
      ],
      nameOf,
    );

    expect(summary.equal).toBe(false);
    expect(summary.entries).toEqual([
      { memberId: "a", name: "Lan", amount: 50_000 },
      { memberId: "b", name: "Hưng", amount: 70_000 },
    ]);
  });

  it("treats a single participant as equal but never as the whole group", () => {
    const summary = summarizeSplit([{ memberId: "a", amount: 120_000 }], nameOf, ["a", "b", "c"]);

    expect(summary.equal).toBe(true);
    expect(summary.names).toEqual(["Lan"]);
    expect(summary.everyone).toBe(false);
  });

  it("marks everyone only when the participants are exactly the active members (3+)", () => {
    const three = ["a", "b", "c"].map((memberId) => ({ memberId, amount: 30_000 }));

    expect(summarizeSplit(three, nameOf, ["c", "a", "b"]).everyone).toBe(true);
    expect(summarizeSplit(three, nameOf, ["a", "b", "c", "d"]).everyone).toBe(false); // one missing
    expect(summarizeSplit(three.slice(0, 2), nameOf, ["a", "b"]).everyone).toBe(false); // only two
    expect(summarizeSplit(three, nameOf).everyone).toBe(false); // no roster given
  });

  it("keeps the order the shares arrive in", () => {
    const summary = summarizeSplit(
      [
        { memberId: "c", amount: 1 },
        { memberId: "a", amount: 1 },
        { memberId: "b", amount: 1 },
      ],
      nameOf,
    );

    expect(summary.names).toEqual(["Mai", "Lan", "Hưng"]);
  });

  it("handles an empty share list without throwing", () => {
    const summary = summarizeSplit([], nameOf, ["a", "b", "c"]);

    expect(summary.equal).toBe(true);
    expect(summary.everyone).toBe(false);
    expect(summary.names).toEqual([]);
    expect(summary.entries).toEqual([]);
  });
});
