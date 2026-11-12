import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LedgerEntry, LedgerTotals, StatsBucket, StatsMember } from "@/lib/types";

import { BarChart } from "./BarChart";
import { DonutChart } from "./DonutChart";
import { MemberFlowChart } from "./MemberFlowChart";
import { WaterfallChart } from "./WaterfallChart";

/**
 * A render smoke test for the two charts.
 *
 * `npm test` runs in the node environment with no DOM, which is enough for `renderToStaticMarkup`:
 * it exercises the component bodies (hook order, the SVG path arithmetic, the empty branches) and
 * gives back the markup a browser would receive. It cannot check layout - no width, no paint - but
 * it does catch a chart that throws or renders an empty frame, which a typecheck cannot.
 */

const buckets = (amounts: number[]): StatsBucket[] =>
  amounts.map((amount, index) => ({
    key: String(index + 1).padStart(2, "0"),
    label: `T${index + 1}`,
    amount,
    count: amount > 0 ? 1 : 0,
  }));

const member = (memberId: string, name: string, owed: number, paid = owed): StatsMember => ({
  memberId,
  name,
  removed: false,
  owed,
  paid,
});

describe("BarChart", () => {
  it("renders a y axis, a column per bucket and the hidden table of every value", () => {
    const html = renderToStaticMarkup(
      createElement(BarChart, { buckets: buckets([120_000, 0, 80_000]), title: "Chi tiêu theo tháng" }),
    );

    // One mark per bucket: two columns plus a stub for the empty one. (The trailing quote-or-space
    // excludes `chart-bar-hit`, which is the invisible tap target rather than a mark.)
    expect(html.match(/class="chart-bar[ "]/g)?.length).toBe(3);
    expect(html).toContain("var(--chart-empty)");
    // The axis is labelled in the compact form and the table keeps the exact amounts.
    expect(html).toContain("chart-tick-label");
    expect(html).toContain("120.000");
    // One hidden table row per bucket, plus its header row.
    expect(html.match(/<tr>/g)?.length).toBe(4);
    expect(html).toContain('class="visually-hidden"');
  });

  it("keeps the detail line on a bucket when the set is a single month", () => {
    const html = renderToStaticMarkup(
      createElement(BarChart, { buckets: buckets([50_000]), title: "Chi tiêu theo tháng" }),
    );

    expect(html).toContain("chart-detail");
    expect(html).toContain("50.000");
    expect(html).not.toContain("Chưa có cột nào");
  });
});

describe("DonutChart", () => {
  it("draws one whole ring for a lone member", () => {
    const html = renderToStaticMarkup(
      createElement(DonutChart, { members: [member("m1", "An", 90_000)] }),
    );

    // One arc, no gap: the dash covers the full circumference minus nothing.
    expect(html.match(/class="chart-slice"/g)?.length).toBe(1);
    expect(html).toContain("100%");
    expect(html).toContain("90.000");
  });

  it("merges everything past the sixth member into Khác", () => {
    const members = Array.from({ length: 9 }, (_, index) =>
      member(`m${index}`, `Người ${index}`, 1_000 * (9 - index)),
    );
    const html = renderToStaticMarkup(createElement(DonutChart, { members }));

    expect(html.match(/class="chart-slice"/g)?.length).toBe(6);
    expect(html).toContain("Khác");
  });

  it("shows the empty state instead of a ring when nobody has activity", () => {
    const html = renderToStaticMarkup(
      createElement(DonutChart, { members: [member("m1", "An", 0, 0)] }),
    );

    expect(html).not.toContain("chart-slice");
    expect(html).toContain("Chưa có chi tiêu trong khoảng này");
  });
});

/** Ledger entries whose running balance follows `deltas`, optionally from an opening level. */
const ledger = (deltas: number[], opening = 0, kinds: LedgerEntry["kind"][] = []): LedgerEntry[] => {
  let running = opening;
  return deltas.map((delta, index) => {
    running += delta;
    const kind = kinds[index] ?? "expense";
    return {
      expenseId: `e${index}`,
      kind,
      title: `Khoản ${index + 1}`,
      spentAt: "2026-11-01T03:00:00.000Z",
      paidByMemberId: "m1",
      paidByName: "An",
      paid: Math.max(0, delta),
      share: Math.max(0, -delta),
      delta,
      runningNet: running,
      settledAfter: running === 0,
      counterpartyMemberId: kind === "payment" ? "m2" : null,
      counterpartyName: kind === "payment" ? "Bình" : null,
    };
  });
};

describe("MemberFlowChart", () => {
  const totals = (overrides: Partial<LedgerTotals>): LedgerTotals => ({
    spentPaid: 0,
    spentOwed: 0,
    paymentsOut: 0,
    paymentsIn: 0,
    net: 0,
    ...overrides,
  });

  it("shows the four labelled values with their full amounts and a gain sentence", () => {
    const html = renderToStaticMarkup(
      createElement(MemberFlowChart, {
        totals: totals({ spentPaid: 300_000, spentOwed: 120_000, paymentsOut: 50_000, paymentsIn: 0, net: 130_000 }),
      }),
    );

    expect(html).toContain("Đã chi ứng trước");
    expect(html).toContain("Phần phải chịu");
    expect(html).toContain("Đã chuyển đi");
    expect(html).toContain("Đã nhận về");
    expect(html).toContain("300.000");
    expect(html).toContain("Cuối cùng được nhận lại 130.000");
  });

  it("says the owing sentence when the member still has to pay", () => {
    const html = renderToStaticMarkup(
      createElement(MemberFlowChart, { totals: totals({ spentPaid: 10_000, spentOwed: 90_000, net: -80_000 }) }),
    );

    expect(html).toContain("Cuối cùng còn phải trả 80.000");
  });

  it("says Đã huề when the net is exactly zero", () => {
    const html = renderToStaticMarkup(createElement(MemberFlowChart, { totals: totals({}) }));

    expect(html).toContain("Đã huề");
  });
});

describe("WaterfallChart", () => {
  it("draws one bar per entry plus the marker, and the summary names the final balance", () => {
    const entries = ledger([100_000, -250_000, 50_000], 0, ["expense", "payment", "expense"]);
    const html = renderToStaticMarkup(createElement(WaterfallChart, { entries, title: "Dòng tiền" }));

    expect(html.match(/class="wf-bar /g)?.length).toBe(3);
    expect(html).toContain("Số dư hiện tại: -100.000đ");
    expect(html).toContain('aria-label="Dòng tiền: 3 khoản');
    expect(html).toContain("wf-zero");
  });

  it("marks transfers as outlined and rising or falling bars with a triangle", () => {
    const entries = ledger([100_000, -250_000], 0, ["payment", "expense"]);
    const html = renderToStaticMarkup(createElement(WaterfallChart, { entries, title: "Dòng tiền" }));

    expect(html).toContain("wf-payment");
    expect(html).toContain("wf-spend");
    expect(html).toContain("wf-arrow-up");
    expect(html).toContain("wf-arrow-down");
  });

  it("shows the Vietnamese empty state and no chart when nothing has happened", () => {
    const html = renderToStaticMarkup(createElement(WaterfallChart, { entries: [], title: "Dòng tiền" }));

    expect(html).toContain("Chưa có lần chi hoặc nhận nào.");
    expect(html).not.toContain("wf-plot");
  });

  it("draws a single entry as a full bar with the marker beside it", () => {
    const html = renderToStaticMarkup(
      createElement(WaterfallChart, { entries: ledger([-75_000]), title: "Dòng tiền" }),
    );

    expect(html.match(/class="wf-bar /g)?.length).toBe(1);
    expect(html).toContain("Số dư hiện tại: -75.000đ");
  });

  it("keeps a long list (60 entries) in a scrolling plot rather than shrinking it", () => {
    const deltas = Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? 10_000 : -4_000));
    const html = renderToStaticMarkup(
      createElement(WaterfallChart, { entries: ledger(deltas), title: "Dòng tiền" }),
    );

    expect(html.match(/class="wf-bar /g)?.length).toBe(60);
    expect(html).toContain("wf-scroll");
    expect(html).toContain("<details");
    // The full table: one row per entry plus the header row.
    expect(html.match(/<tr>/g)?.length).toBe(61);
  });
});
