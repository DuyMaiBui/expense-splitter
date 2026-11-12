"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { formatDateTime, formatVnd } from "@/lib/format";
import { formatCompactVnd } from "@/lib/stats";
import type { LedgerEntry } from "@/lib/types";

import {
  WATERFALL_LAYOUT,
  barSpan,
  clampSelection,
  columnCenter,
  columnLayout,
  columnLeft,
  levelToY,
  moveSelection,
  openingLevel,
  waterfallDomain,
  waterfallSteps,
  type WaterfallStep,
} from "./waterfall-math";

/**
 * One member's running balance as a waterfall: every entry is one bar that rises (the member is
 * owed more) or falls (they owe more) from the previous running balance, and the last column is
 * the "Số dư hiện tại" marker the bars land on.
 *
 * Encoding, never colour alone:
 * - direction: a triangle above a rising bar (▲, green) or below a falling bar (▼, red);
 * - kind: a solid bar is a spend (chi tiêu), an outlined bar is a transfer (trả nợ).
 *
 * The y-axis is its own fixed SVG, so it stays on screen while the plot scrolls sideways. A long
 * list (~60 entries) keeps every bar at least 20px wide, and the scroll starts at the newest bar.
 * The plot is fixed-pixel (1 unit = 1 CSS px), so it needs a container of at least ~300px.
 */

interface WaterfallChartProps {
  /** The slice to draw, already chosen by the page, in ledger order. */
  entries: LedgerEntry[];
  /** What the chart measures, e.g. "Dòng tiền theo thời gian". Also the screen-reader subject. */
  title: string;
}

const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  expense: "Chi tiêu",
  payment: "Trả nợ",
};

export function WaterfallChart({ entries, title }: WaterfallChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Array<SVGGElement | null>>([]);
  const [selected, setSelected] = useState<number | null>(null);

  // Start at the newest bar: a long list must not open at its oldest end.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollLeft = node.scrollWidth;
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return <p className="empty">Chưa có lần chi hoặc nhận nào.</p>;
  }

  const L = WATERFALL_LAYOUT;
  const steps = waterfallSteps(entries);
  const finalLevel = entries[entries.length - 1]!.runningNet;
  const columns = entries.length + 1; // one per entry, plus the marker
  const markerIndex = entries.length;
  const current = clampSelection(selected, columns);

  const domain = waterfallDomain([
    openingLevel(entries),
    ...steps.flatMap((step) => [step.from, step.to]),
  ]);
  const layout = columnLayout(columns);
  const svgHeight = L.top + L.plotHeight + L.labelHeight;
  const axisBase = L.top + L.plotHeight;
  const zeroY = levelToY(0, domain, L.top, L.plotHeight);
  const finalY = levelToY(finalLevel, domain, L.top, L.plotHeight);

  const summary = `${title}: ${entries.length} khoản, số dư hiện tại ${formatVnd(finalLevel)}.`;

  function selectColumn(index: number) {
    setSelected(index);
  }

  function onColumnKey(event: KeyboardEvent<SVGGElement>, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(index);
      return;
    }
    const next = moveSelection(index, event.key, columns);
    if (next !== null) {
      event.preventDefault();
      setSelected(next);
      columnRefs.current[next]?.focus();
    }
  }

  const activeStep: WaterfallStep | null = current < markerIndex ? steps[current]! : null;
  const bandLeft = columnLeft(current, layout);

  return (
    <div className="stack">
      <div className="wf-frame">
        <svg
          className="wf-axis"
          width={L.axisWidth}
          height={svgHeight}
          viewBox={`0 0 ${L.axisWidth} ${svgHeight}`}
          aria-hidden="true"
          focusable="false"
        >
          {domain.ticks.map((tick) => {
            const y = levelToY(tick, domain, L.top, L.plotHeight);
            return (
              <text
                key={tick}
                className="chart-tick-label"
                x={L.axisWidth - 6}
                y={y + 3}
                textAnchor="end"
              >
                {formatCompactVnd(tick)}
              </text>
            );
          })}
        </svg>

        <div className="wf-scroll" ref={scrollRef}>
          <svg
            className="wf-plot"
            width={layout.svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${layout.svgWidth} ${svgHeight}`}
            role="group"
            aria-label={summary}
          >
            {/* The selected column is highlighted by a band behind it, not by colour alone. */}
            <rect
              className="wf-band"
              x={bandLeft}
              y={L.top}
              width={layout.slot}
              height={L.plotHeight}
            />

            {/* Gridlines: solid hairlines one step off the surface, the zero line on top. */}
            {domain.ticks.map((tick) =>
              tick === 0 ? null : (
                <line
                  key={tick}
                  className="chart-axis-line"
                  x1={0}
                  x2={layout.svgWidth}
                  y1={levelToY(tick, domain, L.top, L.plotHeight)}
                  y2={levelToY(tick, domain, L.top, L.plotHeight)}
                />
              ),
            )}
            <line className="wf-zero" x1={0} x2={layout.svgWidth} y1={zeroY} y2={zeroY} />

            {steps.map((step) => {
              const index = step.index;
              const centre = columnCenter(index, layout);
              const barLeft = centre - layout.barWidth / 2;
              const span = barSpan(step.from, step.to, domain, L.top, L.plotHeight, L.minBarPx);
              const bottom = span.y + span.height;
              const isPayment = step.entry.kind === "payment";
              const barClass = [
                "wf-bar",
                step.direction === "up" ? "wf-up" : step.direction === "down" ? "wf-down" : "wf-flat",
                isPayment ? "wf-payment" : "wf-spend",
              ].join(" ");
              return (
                <g
                  key={`${step.entry.expenseId}-${index}`}
                  ref={(node) => {
                    columnRefs.current[index] = node;
                  }}
                  className="wf-column"
                  role="button"
                  tabIndex={0}
                  aria-pressed={index === current}
                  aria-label={describeStep(step)}
                  onPointerEnter={() => selectColumn(index)}
                  onFocus={() => selectColumn(index)}
                  onClick={() => selectColumn(index)}
                  onKeyDown={(event) => onColumnKey(event, index)}
                >
                  <rect
                    className="wf-hit"
                    x={columnLeft(index, layout)}
                    y={L.top}
                    width={layout.slot}
                    height={L.plotHeight}
                  />
                  <rect
                    className={barClass}
                    x={barLeft}
                    y={span.y}
                    width={layout.barWidth}
                    height={span.height}
                  />
                  {step.direction === "up" && (
                    <path
                      className="wf-arrow wf-arrow-up"
                      d={`M ${centre - 4} ${span.y - 2} L ${centre + 4} ${span.y - 2} L ${centre} ${span.y - 8} Z`}
                    />
                  )}
                  {step.direction === "down" && (
                    <path
                      className="wf-arrow wf-arrow-down"
                      d={`M ${centre - 4} ${bottom + 2} L ${centre + 4} ${bottom + 2} L ${centre} ${bottom + 8} Z`}
                    />
                  )}
                  {shouldShowDate(index, layout.labelStep, columns) && (
                    <text
                      className="chart-tick-label"
                      x={centre}
                      y={axisBase + 16}
                      textAnchor="middle"
                    >
                      {shortDate(step.entry.spentAt)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* The final marker: the level the last bar lands on, labelled and selectable. */}
            <g
              ref={(node) => {
                columnRefs.current[markerIndex] = node;
              }}
              className="wf-column"
              role="button"
              tabIndex={0}
              aria-pressed={markerIndex === current}
              aria-label={`Số dư hiện tại: ${formatVnd(finalLevel)}`}
              onPointerEnter={() => selectColumn(markerIndex)}
              onFocus={() => selectColumn(markerIndex)}
              onClick={() => selectColumn(markerIndex)}
              onKeyDown={(event) => onColumnKey(event, markerIndex)}
            >
              <rect
                className="wf-hit"
                x={columnLeft(markerIndex, layout)}
                y={L.top}
                width={layout.slot}
                height={L.plotHeight}
              />
              <line
                className="wf-marker"
                x1={columnCenter(markerIndex, layout) - layout.barWidth / 2}
                x2={columnCenter(markerIndex, layout) + layout.barWidth / 2}
                y1={finalY}
                y2={finalY}
              />
              <text className="chart-tick-label" x={columnCenter(markerIndex, layout)} y={axisBase + 16} textAnchor="middle">
                Hiện tại
              </text>
            </g>
          </svg>
        </div>
      </div>

      <p className="wf-legend">
        <span>Khối đặc: chi tiêu</span>
        <span>Khối viền: trả nợ</span>
        <span>
          <span className="wf-key wf-key-up">▲</span> tăng: được nhận thêm
        </span>
        <span>
          <span className="wf-key wf-key-down">▼</span> giảm: phải trả thêm
        </span>
      </p>

      <div className="chart-detail wf-detail" aria-live="polite">
        {activeStep ? <StepDetail step={activeStep} /> : <FinalDetail level={finalLevel} />}
      </div>

      {/* Every entry in text form: the same numbers the bars encode, for a screen reader or a
          copy-paste. Collapsed by default so the phone view stays short. */}
      <details className="wf-table-disclosure">
        <summary>Xem bảng từng khoản</summary>
        <div className="wf-table-wrap">
          <table>
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">Ngày</th>
                <th scope="col">Khoản</th>
                <th scope="col">Loại</th>
                <th scope="col">Đã chi</th>
                <th scope="col">Phần phải chịu</th>
                <th scope="col">Thay đổi</th>
                <th scope="col">Số dư</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.expenseId}-${index}`}>
                  <td>{formatDateTime(entry.spentAt)}</td>
                  <td>{entry.title}</td>
                  <td>{KIND_LABEL[entry.kind]}</td>
                  <td>{formatVnd(entry.paid)}</td>
                  <td>{formatVnd(entry.share)}</td>
                  <td>{signedDelta(entry.delta)}</td>
                  <td>{formatVnd(entry.runningNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function StepDetail({ step }: { step: WaterfallStep }) {
  const { entry } = step;
  const isPayment = entry.kind === "payment";
  return (
    <>
      <p className="wf-detail-title">
        <strong>{entry.title}</strong>
      </p>
      <dl className="wf-detail-grid">
        <dt>Ngày</dt>
        <dd>{formatDateTime(entry.spentAt)}</dd>
        <dt>Loại</dt>
        <dd>{KIND_LABEL[entry.kind]}</dd>
        <dt>Đã chi</dt>
        <dd>{formatVnd(entry.paid)}</dd>
        <dt>Phần phải chịu</dt>
        <dd>{formatVnd(entry.share)}</dd>
        <dt>Thay đổi</dt>
        <dd>{changeWords(entry.delta)}</dd>
        <dt>Số dư sau khoản này</dt>
        <dd>{formatVnd(entry.runningNet)}</dd>
        {isPayment && (
          <>
            <dt>Đối tác</dt>
            <dd>{entry.counterpartyName ?? "Không rõ"}</dd>
          </>
        )}
      </dl>
    </>
  );
}

function FinalDetail({ level }: { level: number }) {
  return (
    <p className="wf-detail-title">
      <strong>Số dư hiện tại</strong>
      {` · ${formatVnd(level)}`}
    </p>
  );
}

/** A screen-reader line for one bar: the same facts as the detail line, in one sentence. */
function describeStep(step: WaterfallStep): string {
  const { entry } = step;
  return `${shortDate(entry.spentAt)} ${entry.title}, ${KIND_LABEL[entry.kind]}, ${changeWords(entry.delta)}, số dư ${formatVnd(entry.runningNet)}`;
}

/** The signed change, with the direction in words: the sign is never the only cue. */
function changeWords(delta: number): string {
  if (delta > 0) {
    return `+${formatVnd(delta)} (được nhận thêm)`;
  }
  if (delta < 0) {
    return `-${formatVnd(Math.abs(delta))} (phải trả thêm)`;
  }
  return "Không đổi";
}

function signedDelta(delta: number): string {
  if (delta > 0) {
    return `+${formatVnd(delta)}`;
  }
  if (delta < 0) {
    return formatVnd(delta);
  }
  return formatVnd(0);
}

/** "dd/mm" from the VN-time date-time, for axis labels. */
function shortDate(iso: string): string {
  return formatDateTime(iso).slice(0, 5);
}

/** A label is drawn on every `step`-th column, never on the one that sits next to the marker. */
function shouldShowDate(index: number, step: number, columns: number): boolean {
  return index % step === 0 && columns - 1 - index >= step;
}
