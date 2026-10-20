import { useState } from "react";

import { formatVnd } from "@/lib/format";
import { formatCompactVnd } from "@/lib/stats";
import type { StatsBucket } from "@/lib/types";

import { axisTicks, barHeight, maxBucketAmount, shouldLabelBucket } from "./chart-math";

/**
 * Spending per bucket as a hand-written SVG column chart: one series, one colour (`--primary`),
 * so there is no legend to add. The selected column is the only label on the chart - every other
 * value is reachable from the axis, the tap detail line, and the hidden table below.
 *
 * No chart library: the viewBox scales to the card on a 375px phone, and the whole point of the
 * component is one shape drawn from `buckets`.
 */

const VB_WIDTH = 320;
const VB_HEIGHT = 168;
/** Left gutter for the compact y-axis labels ("1,2tr"). */
const GUTTER = 38;
const PLOT_TOP = 10;
const PLOT_HEIGHT = 118;
const BASELINE = PLOT_TOP + PLOT_HEIGHT;
const BAR_MAX_WIDTH = 18;
/** A 2px surface gap between neighbours, so touching bars read as separate without a stroke. */
const BAR_GAP = 2;

interface BarChartProps {
  buckets: StatsBucket[];
  /** What the axis measures, e.g. "Chi tiêu theo tháng". Also the screen-reader summary's subject. */
  title: string;
}

export function BarChart({ buckets, title }: BarChartProps) {
  const ticks = axisTicks(maxBucketAmount(buckets), 3);
  const topTick = ticks[ticks.length - 1] ?? 1;
  const plotWidth = VB_WIDTH - GUTTER;
  const band = buckets.length > 0 ? plotWidth / buckets.length : plotWidth;
  const barWidth = Math.min(BAR_MAX_WIDTH, Math.max(1, band - BAR_GAP));

  // The tallest column is selected to begin with, so the detail line is never blank on arrival.
  const peakIndex = buckets.reduce(
    (best, bucket, index) => (bucket.amount > (buckets[best]?.amount ?? 0) ? index : best),
    0,
  );
  const [selected, setSelected] = useState<number>(peakIndex);
  const active = buckets[selected] ?? null;

  const total = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const count = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const summary = `${title}: ${formatVnd(total)}, ${count} khoản, ${buckets.length} cột.`;

  return (
    <div className="stack">
      <div className="chart-frame">
        <svg
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          role="img"
          aria-label={summary}
          preserveAspectRatio="none"
        >
          {/* Gridlines + y labels: solid hairlines, one step off the surface, never dashed. */}
          {ticks.map((tick, index) => {
            const y = BASELINE - (tick / Math.max(1, topTick)) * PLOT_HEIGHT;
            return (
              <g key={tick}>
                {index > 0 && (
                  <line className="chart-axis-line" x1={GUTTER} x2={VB_WIDTH} y1={y} y2={y} />
                )}
                <text className="chart-tick-label" x={GUTTER - 5} y={y + 3} textAnchor="end">
                  {formatCompactVnd(tick)}
                </text>
              </g>
            );
          })}
          <line className="chart-axis-line" x1={GUTTER} x2={VB_WIDTH} y1={BASELINE} y2={BASELINE} />

          {buckets.map((bucket, index) => {
            const height = barHeight(bucket.amount, topTick, PLOT_HEIGHT);
            const x = GUTTER + index * band + (band - barWidth) / 2;
            const y = BASELINE - height;
            const isActive = index === selected;
            const rounded = Math.min(3, barWidth / 2, height / 2);
            return (
              <g
                key={bucket.key}
                role="button"
                tabIndex={0}
                aria-label={`${bucket.label}: ${formatVnd(bucket.amount)}, ${bucket.count} khoản`}
                aria-pressed={isActive}
                className="chart-bar-hit"
                onPointerEnter={() => setSelected(index)}
                onFocus={() => setSelected(index)}
                onClick={() => setSelected(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(index);
                  }
                }}
              >
                {/* The transparent hit area spans the whole band and the full plot height, so a
                    7px column is still easy to hit with a thumb. */}
                <rect x={GUTTER + index * band} y={PLOT_TOP} width={band} height={PLOT_HEIGHT} fill="transparent" />
                {bucket.amount > 0 ? (
                  <path
                    className={isActive ? "chart-bar" : "chart-bar chart-bar-idle"}
                    fill="var(--primary)"
                    d={`M ${x} ${BASELINE} L ${x} ${y + rounded} Q ${x} ${y} ${x + rounded} ${y} L ${x + barWidth - rounded} ${y} Q ${x + barWidth} ${y} ${x + barWidth} ${y + rounded} L ${x + barWidth} ${BASELINE} Z`}
                  />
                ) : (
                  // A zero bucket still draws a faint stub, so the axis reads as a chart.
                  <rect
                    className={isActive ? "chart-bar" : "chart-bar chart-bar-idle"}
                    x={x}
                    y={BASELINE - height}
                    width={barWidth}
                    height={height}
                    fill="var(--chart-empty)"
                  />
                )}
              </g>
            );
          })}

          {buckets.map((bucket, index) =>
            shouldLabelBucket(index, buckets.length) ? (
              <text
                key={`label-${bucket.key}`}
                className="chart-tick-label"
                x={GUTTER + index * band + band / 2}
                y={BASELINE + 13}
                textAnchor="middle"
              >
                {bucket.label}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <p className="chart-detail" aria-live="polite">
        {active ? (
          <>
            <strong>{active.label}</strong>
            {` · ${formatVnd(active.amount)} · ${active.count} khoản`}
          </>
        ) : (
          <span className="muted">Chưa có cột nào.</span>
        )}
      </p>

      {/* The values the chart encodes visually, in text form: a screen reader, a screenshot
          reader and a copy-paste all get the same numbers. */}
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Mốc</th>
            <th scope="col">Số tiền</th>
            <th scope="col">Số khoản</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              <td>{formatVnd(bucket.amount)}</td>
              <td>{bucket.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
