import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StatsBucket, StatsMember } from "@/lib/types";

import { BarChart } from "./BarChart";
import { DonutChart } from "./DonutChart";

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
