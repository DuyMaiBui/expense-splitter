"use client";

import { formatVnd } from "@/lib/format";
import type { LedgerTotals } from "@/lib/types";

import { flowPercent } from "./waterfall-math";

/**
 * A member's totals as four horizontal bars on one shared scale: the largest of the four fills
 * its track, the others are proportional to it. Two pairs: spending (chi tiêu) and settlement
 * (trả nợ). Each bar carries its full value as text, so the bar is never the only carrier of
 * a number.
 *
 * Plain HTML bars rather than an SVG viewBox: the bars need no pixel-exact text, and a track of
 * percentage width reflows on any phone without a measurement.
 */

interface MemberFlowChartProps {
  totals: LedgerTotals;
}

interface FlowRow {
  label: string;
  value: number;
  tone: "primary" | "secondary";
}

export function MemberFlowChart({ totals }: MemberFlowChartProps) {
  const max = Math.max(totals.spentPaid, totals.spentOwed, totals.paymentsOut, totals.paymentsIn);

  const groups: Array<{ title: string; rows: FlowRow[] }> = [
    {
      title: "Chi tiêu",
      rows: [
        { label: "Đã chi ứng trước", value: totals.spentPaid, tone: "primary" },
        { label: "Phần phải chịu", value: totals.spentOwed, tone: "secondary" },
      ],
    },
    {
      title: "Trả nợ",
      rows: [
        { label: "Đã chuyển đi", value: totals.paymentsOut, tone: "primary" },
        { label: "Đã nhận về", value: totals.paymentsIn, tone: "secondary" },
      ],
    },
  ];

  return (
    <div className="flow-chart">
      {groups.map((group) => (
        <div key={group.title} className="flow-group" role="group" aria-label={group.title}>
          <p className="flow-group-title">{group.title}</p>
          {group.rows.map((row) => (
            <div key={row.label} className="flow-row">
              <span className="flow-label">{row.label}</span>
              <span className="flow-amount">{formatVnd(row.value)}</span>
              <span className="flow-track">
                <span
                  className={`flow-fill flow-fill--${row.tone}`}
                  style={{ width: `${flowPercent(row.value, max)}%` }}
                  aria-hidden="true"
                />
              </span>
            </div>
          ))}
        </div>
      ))}

      <p className={`flow-result ${resultTone(totals.net)}`}>{flowResultText(totals.net)}</p>
    </div>
  );
}

/** The one sentence that says where the member stands. Sign words, never a bare minus. */
export function flowResultText(net: number): string {
  if (net > 0) {
    return `Cuối cùng được nhận lại ${formatVnd(net)}`;
  }
  if (net < 0) {
    return `Cuối cùng còn phải trả ${formatVnd(Math.abs(net))}`;
  }
  return "Đã huề";
}

function resultTone(net: number): string {
  if (net > 0) {
    return "flow-result--gain";
  }
  if (net < 0) {
    return "flow-result--owe";
  }
  return "flow-result--even";
}
