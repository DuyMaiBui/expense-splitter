import { useId, useMemo, useState } from "react";

import { formatVnd } from "@/lib/format";
import { formatCompactVnd } from "@/lib/stats";
import type { StatsMember } from "@/lib/types";

import { buildSlices, percentLabel, type Slice } from "./chart-math";

/**
 * Share of spending per member as a hand-written SVG ring, with a toggle for the question people
 * actually ask: who CONSUMED the money ("Phải chịu") or who PAID it ("Đã trả").
 *
 * At most six arcs: the tail merges into "Khác". Colour follows the member through the fixed
 * palette order, and the legend carries name, percentage and the exact amount, so nothing is
 * encoded by colour alone.
 */

const SIZE = 200;
const RADIUS = 82;
const STROKE = 24;
/** Degrees between neighbours on the ring: a 2px surface gap, expressed as an arc gap. */
const GAP_DEG = 2;

type Mode = "owed" | "paid";

interface DonutChartProps {
  members: StatsMember[];
}

export function DonutChart({ members }: DonutChartProps) {
  const [mode, setMode] = useState<Mode>("owed");
  const [selected, setSelected] = useState<string | null>(null);
  const titleId = useId();

  const slices = useMemo(() => buildSlices(members, mode), [members, mode]);
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);
  const active = slices.find((slice) => slice.key === selected) ?? null;
  const circumference = 2 * Math.PI * RADIUS;
  const modeLabel = mode === "owed" ? "phải chịu" : "đã trả";

  if (total === 0) {
    return (
      <div className="stack">
        <ModeToggle mode={mode} onChange={setMode} />
        <p className="empty">Chưa có chi tiêu trong khoảng này.</p>
      </div>
    );
  }

  const summary = `${mode === "owed" ? "Phải chịu" : "Đã trả"} theo thành viên: ${slices
    .map((slice) => `${slice.label} ${percentLabel(slice.share, slice.amount)}%`)
    .join(", ")}.`;

  return (
    <div className="stack">
      <ModeToggle mode={mode} onChange={setMode} />

      <div className="chart-frame">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-labelledby={titleId}
          aria-label={summary}
        >
          <title id={titleId}>{summary}</title>
          {/* The ring is drawn as one circle per slice: dash offsets rather than path arcs, so a
              single 100% slice needs no special case and the gap is a plain dash adjustment. */}
          {slices.map((slice, index) => (
            <SliceArc
              key={slice.key}
              slice={slice}
              circumference={circumference}
              dimmed={active !== null && active.key !== slice.key}
              onSelect={() => setSelected(slice.key)}
              label={
                slices.length === 1
                  ? `${slice.label} 100%`
                  : `${slice.label} ${percentLabel(slice.share, slice.amount)}%`
              }
              index={index}
            />
          ))}
          <text className="chart-donut-total" x={SIZE / 2} y={SIZE / 2 - 2} textAnchor="middle">
            {formatCompactVnd(total)}
          </text>
          <text className="chart-donut-caption" x={SIZE / 2} y={SIZE / 2 + 12} textAnchor="middle">
            {mode === "owed" ? "phải chịu" : "đã trả"}
          </text>
        </svg>
      </div>

      {active && (
        <p className="chart-detail">
          <strong>{active.label}</strong>
          {` · ${formatVnd(active.amount)} · ${percentLabel(active.share, active.amount)}% ${modeLabel}`}
        </p>
      )}

      <div className="chart-legend">
        {slices.map((slice) => {
          const percent = percentLabel(slice.share, slice.amount);
          const isActive = slice.key === selected;
          return (
            <button
              key={slice.key}
              type="button"
              className="chart-legend-row"
              aria-pressed={isActive}
              onClick={() => setSelected(isActive ? null : slice.key)}
            >
              <span
                className="chart-swatch"
                style={{ background: `var(--chart-${slice.colorIndex + 1})` }}
                aria-hidden="true"
              />
              <span className="truncate grow" title={slice.label}>
                {slice.label}
                {slice.removed && <span className="badge"> đã xóa</span>}
              </span>
              <span className="chart-legend-value">{percent}%</span>
              <span className="amount">{formatVnd(slice.amount)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Cách tính phần của mỗi người">
      <button type="button" aria-pressed={mode === "owed"} onClick={() => onChange("owed")}>
        Phải chịu
      </button>
      <button type="button" aria-pressed={mode === "paid"} onClick={() => onChange("paid")}>
        Đã trả
      </button>
    </div>
  );
}

interface SliceArcProps {
  slice: Slice;
  circumference: number;
  dimmed: boolean;
  label: string;
  index: number;
  onSelect: () => void;
}

function SliceArc({ slice, circumference, dimmed, label, index, onSelect }: SliceArcProps) {
  // One gap is subtracted from every arc but the last: with a single slice a gap would leave a
  // visible seam in a full ring, so the lone slice is drawn whole.
  const gap = slice.length >= 1 ? 0 : (GAP_DEG / 360) * circumference;
  const length = Math.max(0, slice.length * circumference - gap);
  const dash = `${length} ${circumference - length}`;
  const offset = -(slice.start * circumference) - gap / 2;

  return (
    <circle
      className="chart-slice"
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      fill="none"
      stroke={`var(--chart-${slice.colorIndex + 1})`}
      strokeWidth={STROKE}
      strokeDasharray={dash}
      strokeDashoffset={offset}
      opacity={dimmed ? 0.4 : 1}
      transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerEnter={onSelect}
      onFocus={onSelect}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      data-index={index}
    />
  );
}
